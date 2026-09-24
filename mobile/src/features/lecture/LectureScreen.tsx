import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { CANCELLATION_NET_THRESHOLD, CANCELLATION_THRESHOLD, ReportStance, VERDICT_STATES, VerdictState } from '../../core/cancellation';
import { CONFIRM_THRESHOLD, Deadline, deadlineKindLabel, isSatInClass } from '../../core/deadline';
import { Attendance, Lecturer, lecturerDisplayName, lecturerInitials } from '../../core/misc';
import { locationDisplay } from '../../core/roomLocation';
import { formatComplete, formatTime, formatWeekdayDayMonth } from '../../core/time';
import { eventTypeLabel, groupLabelOf, TimetableEvent, titleOf } from '../../core/timetableEvent';
import { PrefKey } from '../../data/storage';
import { useModel, usePrefJSON, useServices } from '../../state/hooks';
import {
  ActionRow, ConfirmSheet, IconName, Label, LabeledRow, ListScroll, Row, Section, ToggleRow, Txt,
} from '../../ui/components';
import { deadlineTint } from '../../ui/meaning';
import { Space, useTheme, withAlpha } from '../../ui/theme';
import { DeadlineForm, DeadlineRow } from '../deadlines/DeadlineRows';
import { LectureModel } from './LectureModel';

/**
 * Everything known about one class, on its own page. Three kinds of information share it
 * and are kept visually distinct because they carry different weight: what the university
 * says (times, room, staff), what other students say (reports, deadlines), and what this
 * student has decided (not attending).
 */
export function LectureScreen({ event, isClashing, known }: { event: TimetableEvent; isClashing: boolean; known: Deadline[] }) {
  const services = useServices();
  const theme = useTheme();
  const model = useModel(useMemo(() => new LectureModel(services, event, known), [services, event, known]));
  const [skipped, setSkipped] = usePrefJSON<string[]>(PrefKey.skipped, []);
  const [showingForm, setShowingForm] = useState(false);
  /** Non-null while the "are you sure?" card is up, holding the side being reported. */
  const [pendingReport, setPendingReport] = useState<ReportStance | null>(null);
  const isSkipping = skipped.includes(model.eventKey);
  const status = model.status;

  useEffect(() => {
    void model.load();
  }, [model]);

  const verdictIcon = (state: VerdictState): IconName => (state === 'cancelled' ? 'cancelled' : state === 'running' ? 'running' : 'moved');
  const verdictTitle = (state: VerdictState) => (state === 'cancelled' ? 'Mark as cancelled' : state === 'running' ? 'Mark as on' : 'Mark as moved');

  return (
    <>
      <ListScroll refreshing={model.isLoading && model.deadlines.length > 0} onRefresh={() => void model.load()}>
        {/*
          What has been reported, in orange, before anything else: a student opening this
          page ten minutes before a 9am has one question. Their own report leads, because
          "did I already do this?" is the other half of it.
        */}
        {!status.isDecided && (status.myReportLine || status.othersLine) ? (
          <Section bare>
            <View style={styles.banner}>
              <Label icon="report" text={status.myReportLine ?? status.othersLine ?? ''} type="status" color={theme.tint.off} />
              <View style={styles.bannerLines}>
                {status.myReportLine && status.othersLine ? <Txt type="caption" color={theme.tint.off}>{status.othersLine}</Txt> : null}
                {status.disputedLine ? <Txt type="caption" color={theme.tint.off}>{status.disputedLine}</Txt> : null}
              </View>
            </View>
          </Section>
        ) : null}

        {/* The very top of the page: what's due at this exact class today, and nothing else. */}
        {model.dueHere.length > 0 ? (
          <Section>
            {model.dueHere.map((d) => (
              <Row key={d.id}>
                <Label
                  icon={isSatInClass(d.kind) ? 'test' : 'assignment'}
                  text={isSatInClass(d.kind) ? `${deadlineKindLabel(d.kind)} in this class` : `${deadlineKindLabel(d.kind)} due at this class`}
                  type="status"
                  color={deadlineTint(d.kind, theme)}
                />
                <Txt type="headline">{d.title}</Txt>
                <Txt type="caption" color={theme.inkSecondary}>{formatComplete(d.due)}</Txt>
              </Row>
            ))}
          </Section>
        ) : null}

        <Section>
          <Row>
            <Txt type="pageTitle">{titleOf(event)}</Txt>
            <Txt type="subheadline" color={theme.inkSecondary}>{groupLabelOf(event)}</Txt>
            {isSkipping ? <Label icon="notAttending" text="You're not attending this" type="caption" color={theme.inkSecondary} /> : null}
          </Row>
        </Section>

        <Section header="Class">
          <LabeledRow label="Time" value={`${formatTime(event.start)}–${formatTime(event.end)}`} />
          <LabeledRow label="Date" value={formatWeekdayDayMonth(event.start)} />
          <LabeledRow label="Where" value={locationDisplay(event)} />
          <LabeledRow label="Delivery" value={eventTypeLabel(event.type)} />
          {event.activity.moduleCode ? <LabeledRow label="Module" value={event.activity.moduleCode} /> : null}
          <LabeledRow label="Activity" value={event.activity.raw} />
          {event.weekLabels.length > 0 ? <LabeledRow label="Weeks" value={event.weekLabels.join(', ')} /> : null}
          {isClashing ? <Row><Label icon="warning" text="Overlaps another class" color={theme.tint.off} /></Row> : null}
        </Section>

        <Section header="Taught by">
          {model.lecturers.length === 0 ? (
            <Row><Txt color={theme.inkSecondary}>No staff listed for this class</Txt></Row>
          ) : (
            model.lecturers.map((l) => <LecturerRow key={l.name} lecturer={l} />)
          )}
        </Section>

        <Section footer="Only you see this. It doesn't report the class as cancelled.">
          <ToggleRow value={isSkipping} onChange={() => setSkipped(Attendance.toggling(model.eventKey, skipped))}>
            <Label icon="notAttending" text="I won't attend this" />
          </ToggleRow>
        </Section>

        <Section
          header="Is it on?"
          footer={
            model.canDecide
              ? 'Your decision replaces the count for everyone straight away. Say it\'s on to clear a wrong report.'
              : `Reports are anonymous. A class is flagged with an orange ! once ${CANCELLATION_THRESHOLD} people report it and they stay ${CANCELLATION_NET_THRESHOLD} ahead of anyone saying it went ahead.`
          }
        >
          {/*
            A stated verdict and a tally of guesses are different claims, so they are drawn
            differently. Collapsing the two would make one person's mistake look like a consensus.
          */}
          {status.verdict ? (
            <Row>
              <Label
                icon={verdictIcon(status.verdict.state)}
                text={status.summary}
                type="headline"
                color={status.verdict.state === 'running' ? theme.ink : theme.tint.off}
              />
              {status.verdict.note ? <Txt type="callout" color={theme.inkSecondary}>{status.verdict.note}</Txt> : null}
              {/* The crowd is shown underneath rather than replaced: disagreement is worth seeing. */}
              {status.crowdSummary ? <Txt type="caption" color={theme.inkSecondary}>{status.crowdSummary}</Txt> : null}
            </Row>
          ) : status.isFlagged ? (
            <Row><Label icon="alert" text={status.summary} color={theme.tint.off} /></Row>
          ) : (
            <Row><Txt color={theme.inkSecondary}>{status.summary}</Txt></Row>
          )}

          {model.canDecide
            ? VERDICT_STATES.map((state) => (
                <ActionRow
                  key={state}
                  title={verdictTitle(state)}
                  icon={verdictIcon(state)}
                  disabled={model.isBusy || status.verdict?.state === state}
                  onPress={() => void model.decide(state)}
                />
              ))
            : status.myStance !== null
              // Not destructive: taking back your own report isn't a delete.
              ? <ActionRow title="Undo my report" icon="undo" disabled={model.isBusy} onPress={() => void model.withdrawReport()} />
              : [
                  <ActionRow key="c" title="Report: lecture cancelled" icon="reportOutline" disabled={model.isBusy} onPress={() => setPendingReport('cancelled')} />,
                  // Only when there's a cancellation to contradict: silence already means "it ran".
                  status.reportCount > 0
                    ? <ActionRow key="o" title="Report: lecture is on" icon="runningOutline" disabled={model.isBusy} onPress={() => setPendingReport('on')} />
                    : null,
                ]}

          {/* Every write on this page reports its failure; a refused report must not look like a working one. */}
          {model.errorText ? <Row><Label icon="warning" text={model.errorText} type="caption" color={theme.tint.off} /></Row> : null}
        </Section>

        <Section
          header={`All ${model.moduleKey} dates`}
          footer={`Shared with everyone taking this module. Confirm the ones you know are right — a deadline is flagged as confirmed once ${CONFIRM_THRESHOLD} people have vouched for it. You can only remove your own.`}
        >
          {model.isLoading && model.deadlines.length === 0 ? (
            <Row><ActivityIndicator color={theme.inkSecondary} /></Row>
          ) : model.deadlines.length === 0 ? (
            <Row><Txt color={theme.inkSecondary}>No deadlines shared for {model.moduleKey} yet</Txt></Row>
          ) : (
            model.deadlines.map((d) => (
              <DeadlineRow
                key={d.id}
                deadline={d}
                standing={model.standing(d)}
                isMine={model.isMine(d)}
                variant="module"
                actions={{
                  onConfirm: () => void model.toggleConfirmation(d),
                  onDelete: () => void model.removeDeadline(d),
                  onReport: (reason) => void model.reportDeadline(d, reason),
                  onHideAuthor: () => void model.hideAuthor(d),
                }}
              />
            ))
          )}
          <ActionRow title="Add a deadline" icon="add" onPress={() => setShowingForm(true)} />
        </Section>
      </ListScroll>

      <DeadlineForm
        visible={showingForm}
        onClose={() => setShowingForm(false)}
        onSubmit={(title, kind, due) => void model.addDeadline(title, kind, due)}
      />
      <ConfirmSheet
        visible={pendingReport !== null}
        onClose={() => setPendingReport(null)}
        title={pendingReport === 'on' ? 'Report that this lecture went ahead?' : 'Report this lecture as cancelled?'}
        message="Everyone taking this module sees the count. You can undo it afterwards."
        confirmTitle={pendingReport === 'on' ? 'Report it was on' : 'Report cancelled'}
        icon={pendingReport === 'on' ? 'running' : 'report'}
        // The same orange the banner and the timetable outline use.
        tint={pendingReport === 'on' ? theme.accent : theme.tint.off}
        fill={pendingReport === 'on' ? undefined : theme.tint.offFill}
        onConfirm={() => pendingReport && void model.report(pendingReport)}
      />
    </>
  );
}

/** A photo when one is known, initials otherwise — never an empty grey box. */
function LecturerRow({ lecturer }: { lecturer: Lecturer }) {
  const theme = useTheme();
  const initials = (
    <View style={[styles.avatar, { backgroundColor: withAlpha(theme.accent, 0.15) }]}>
      <Txt type="caption" color={theme.accent} style={styles.bold}>{lecturerInitials(lecturer)}</Txt>
    </View>
  );
  return (
    <Row>
      <View style={styles.lecturer}>
        {lecturer.photoURL ? <Image source={{ uri: lecturer.photoURL }} style={styles.avatar} accessibilityIgnoresInvertColors /> : initials}
        <View style={styles.fill}>
          <Txt>{lecturerDisplayName(lecturer)}</Txt>
          {lecturer.role ? <Txt type="caption" color={theme.inkSecondary}>{lecturer.role}</Txt> : null}
        </View>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  banner: { gap: Space.xxs, paddingHorizontal: Space.xs },
  bannerLines: { marginLeft: 26, gap: Space.xxs },
  lecturer: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '600' },
  fill: { flex: 1 },
});
