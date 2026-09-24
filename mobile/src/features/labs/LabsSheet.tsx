import { StyleSheet, View } from 'react-native';
import { decodeProfile, LabRotation, LabRotations, LabSession, labSessionID } from '../../core/profile';
import { PrefKey } from '../../data/storage';
import { currentRotation } from '../../data/timetable';
import { usePref, usePrefJSON, useServices } from '../../state/hooks';
import { BarButton, EmptyState, ListScroll, Row, Section, Segmented, Sheet, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

/**
 * Year-1 Engineering lab rotation. The public timetable only shows generic lab slots; this
 * uses the School's published rotation to show a student their exact labs for their group —
 * the one their profile was matched to, or one they pick.
 */
export function LabsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const services = useServices();
  const [picked, setPicked] = usePref(PrefKey.engLabGroup);
  const [profileRaw] = usePrefJSON<unknown>(PrefKey.profile, null);
  // The profile's group is the matched one; start there unless the student picked another.
  const group = picked ?? decodeProfile(profileRaw)?.group ?? '';
  const rotation = visible ? currentRotation(services.rotationCache) : null;

  return (
    <Sheet visible={visible} title="Engineering labs" onClose={onClose} right={<BarButton title="Done" bold onPress={onClose} />}>
      {rotation ? (
        <Rotation rotation={rotation} group={group} onPick={(g) => setPicked(g === '' ? null : g)} />
      ) : (
        <EmptyState icon="labs" title="Rotation unavailable" />
      )}
    </Sheet>
  );
}

function Rotation({ rotation, group, onPick }: { rotation: LabRotation; group: string; onPick: (group: string) => void }) {
  const theme = useTheme();
  const byWeek = new Map<number, LabSession[]>();
  if (group) {
    for (const s of LabRotations.sessionsForGroup(rotation, group)) byWeek.set(s.week, [...(byWeek.get(s.week) ?? []), s]);
  }
  return (
    <ListScroll>
      <Section header="Your group">
        <Row>
          <Segmented
            label="Group"
            value={group}
            onChange={onPick}
            options={[{ value: '', label: '—' }, ...LabRotations.groupLetters(rotation).map((g) => ({ value: g, label: g }))]}
          />
        </Row>
      </Section>
      {!group ? (
        <Section>
          <Row><Txt color={theme.inkSecondary}>Pick your group to see your personal lab schedule for the semester.</Txt></Row>
        </Section>
      ) : byWeek.size === 0 ? (
        <Section>
          <Row><Txt color={theme.inkSecondary}>No labs scheduled for Group {group}.</Txt></Row>
        </Section>
      ) : (
        [...byWeek.keys()].sort((a, b) => a - b).map((week) => (
          <Section key={week} header={`Week ${week}`}>
            {byWeek.get(week)!.map((session) => (
              <Row key={labSessionID(session)}>
                <View style={styles.lab}>
                  <View style={styles.times}>
                    <Txt type="subheadline" style={styles.tabular}>{shortTime(session.start)}</Txt>
                    <Txt type="caption" color={theme.inkSecondary} style={styles.tabular}>{shortTime(session.end)}</Txt>
                  </View>
                  <View style={styles.fill}>
                    <Txt type="headline">{session.activity || session.module}</Txt>
                    <Txt type="caption" color={theme.inkSecondary}>{session.module} · {LabRotations.name(rotation, session.module)}</Txt>
                    <Txt type="caption2" color={theme.inkSecondary}>{prettyDate(session)}</Txt>
                  </View>
                </View>
              </Row>
            ))}
          </Section>
        ))
      )}
    </ListScroll>
  );
}

function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  const hour = Number(h);
  if (m === undefined || !Number.isInteger(hour)) return hhmm;
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return m === '00' ? `${h12}${suffix}` : `${h12}:${m}${suffix}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thursday 17 Sep", from the session's calendar date. */
function prettyDate(session: LabSession): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(session.date);
  if (!m) return `${session.day} ${session.date}`;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const styles = StyleSheet.create({
  lab: { flexDirection: 'row', gap: Space.m, alignItems: 'flex-start' },
  times: { width: 56, alignItems: 'flex-end', gap: Space.xxs },
  tabular: { fontVariant: ['tabular-nums'] },
  fill: { flex: 1, gap: Space.xxs },
});
