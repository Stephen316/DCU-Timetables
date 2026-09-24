import { useEffect, useState } from 'react';
import { GroupCatalog, ModuleGroups } from '../../core/groupCatalog';
import { TimetableCategory } from '../../core/timetableEvent';
import { TimetableSource } from '../../data/dcuApi';
import { errorMessage } from '../../data/rest';
import { PrefKey } from '../../data/storage';
import { usePrefJSON } from '../../state/hooks';
import { BarButton, EmptyState, ListScroll, Section, Sheet, Spinner, ToggleRow, Txt } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/**
 * Turns off the lab and tutorial groups a student doesn't attend, so the timetable and
 * clash detection reflect only their own classes. Groups come straight from the
 * programme's live timetable.
 */
export function GroupsSheet({
  visible, onClose, programme, source,
}: { visible: boolean; onClose: () => void; programme: TimetableCategory; source: TimetableSource }) {
  const theme = useTheme();
  const [hiddenList, setHidden] = usePrefJSON<string[]>(PrefKey.hiddenGroups, []);
  const hidden = new Set(hiddenList);
  const [modules, setModules] = useState<ModuleGroups[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const calendar = await source.weekCalendar();
        const events = await source.events(programme, calendar.weeks);
        if (!cancelled) {
          setModules(GroupCatalog.modules(events));
          setErrorText(null);
        }
      } catch (error) {
        if (!cancelled) setErrorText(errorMessage(error, 'Please try again.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, programme, source]);

  /** Closing resets to the spinner, so the next opening loads afresh. */
  const close = () => {
    onClose();
    setLoading(true);
  };

  const toggle = (key: string, isOn: boolean) => {
    const next = new Set(hidden);
    if (isOn) next.delete(key);
    else next.add(key);
    setHidden(next.size === 0 ? null : [...next].sort());
  };

  return (
    <Sheet
      visible={visible}
      title="Your groups"
      onClose={close}
      left={modules.length > 0 && hidden.size > 0 ? <BarButton title="Reset" onPress={() => setHidden(null)} /> : undefined}
      right={<BarButton title="Done" bold onPress={close} />}
    >
      {loading ? (
        <Spinner label="Loading your modules…" />
      ) : errorText ? (
        <EmptyState icon="offline" title="Couldn't load groups" message={errorText} />
      ) : modules.length === 0 ? (
        <EmptyState icon="groups" title="No groups found" message="This programme has no scheduled classes yet." />
      ) : (
        <ListScroll>
          <Section bare>
            <Txt type="subheadline" color={theme.inkSecondary}>
              {"Turn off the lab and tutorial groups you're not in. What's left is your own timetable, and only those classes are checked for clashes."}
            </Txt>
          </Section>
          {modules.map((module) => (
            <Section key={module.moduleCode} header={`${module.moduleCode} · ${module.moduleName}`}>
              {module.groups.map((option) => (
                <ToggleRow key={option.key} value={!hidden.has(option.key)} onChange={(on) => toggle(option.key, on)}>
                  <Txt>{option.label}</Txt>
                </ToggleRow>
              ))}
            </Section>
          ))}
        </ListScroll>
      )}
    </Sheet>
  );
}
