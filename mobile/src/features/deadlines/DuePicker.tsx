import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DatePicking } from '../../core/datePicking';
import { formatTime, formatWeekdayDayMonth, isSameDay, monthName, startOfDay, weekdayName } from '../../core/time';
import { BottomCard, Icon, InlineAction, PrimaryButton, Txt } from '../../ui/components';
import { Radius, Space, useTheme, withAlpha } from '../../ui/theme';

/**
 * The due date and the time as two chips on one line, each opening a popup: a month
 * calendar for the day, a clock-face dial for the time. The same on the phone, in a browser
 * and on the Mac — the browser has no picker of its own worth the name. Changing one keeps
 * the other.
 */
export function DuePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  return (
    <View style={styles.chips}>
      <InlineAction title={formatWeekdayDayMonth(value)} onPress={() => setOpen('date')} />
      <InlineAction title={formatTime(value)} onPress={() => setOpen('time')} />
      <CalendarCard
        visible={open === 'date'}
        value={value}
        onPick={(day) => {
          onChange(DatePicking.withDay(value, day));
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
      <DialCard visible={open === 'time'} value={value} onChange={onChange} onClose={() => setOpen(null)} />
    </View>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL = 40;

/** A month to tap a day on. Days already gone can't be chosen: a deadline is in the future. */
function CalendarCard({ visible, value, onPick, onClose }: {
  visible: boolean;
  value: Date;
  onPick: (day: Date) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const today = startOfDay(new Date());
  const [shown, setShown] = useState({ year: value.getFullYear(), month: value.getMonth() });
  // Opens on the month of the date already chosen.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setShown({ year: value.getFullYear(), month: value.getMonth() });
  }
  const atFirst = shown.year === today.getFullYear() && shown.month === today.getMonth();
  const title = `${monthName(new Date(shown.year, shown.month, 1))} ${shown.year}`;
  const step = (by: number) => setShown(DatePicking.stepMonth(shown.year, shown.month, by));

  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={styles.monthBar}>
        <MonthStep icon="back" label="Previous month" disabled={atFirst} onPress={() => step(-1)} />
        <Txt type="headline" accessibilityRole="header">{title}</Txt>
        <MonthStep icon="forward" label="Next month" onPress={() => step(1)} />
      </View>
      <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((d, i) => (
          <Txt key={i} type="caption" color={theme.inkSecondary} style={styles.weekday}>{d}</Txt>
        ))}
      </View>
      {DatePicking.monthGrid(shown.year, shown.month).map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((day, i) => {
            if (!day) return <View key={i} style={styles.cell} />;
            const past = day < today;
            const chosen = isSameDay(day, value);
            const isToday = isSameDay(day, today);
            return (
              <Pressable
                key={i}
                disabled={past}
                onPress={() => onPick(day)}
                accessibilityRole="button"
                accessibilityLabel={`${weekdayName(day)} ${day.getDate()} ${monthName(day)}`}
                accessibilityState={{ selected: chosen, disabled: past }}
                style={({ pressed }) => [
                  styles.cell,
                  styles.day,
                  chosen && { backgroundColor: theme.accent },
                  !chosen && isToday && { borderWidth: 1.5, borderColor: theme.accent },
                  pressed && !chosen && { backgroundColor: theme.raised },
                ]}
              >
                <Txt
                  type="callout"
                  color={chosen ? theme.onAccent : past ? theme.inkTertiary : theme.ink}
                  style={chosen ? styles.bold : undefined}
                >
                  {day.getDate()}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ))}
    </BottomCard>
  );
}

function MonthStep({ icon, label, disabled, onPress }: { icon: 'back' | 'forward'; label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.monthStep, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={20} color={theme.accent} />
    </Pressable>
  );
}

const DIAL = 248;
const OUTER = 100;
const INNER = 66;
const MARK = 36;

/**
 * A clock face to set the time on, as Android's is: tap the hour — 1 to 12 round the edge,
 * 13 to 00 inside — and it turns to the minutes, in fives. The time sits large above it, and
 * either half can be tapped to go back to it. Each tap applies straight away.
 */
function DialCard({ visible, value, onChange, onClose }: {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [part, setPart] = useState<'hour' | 'minute'>('hour');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setPart('hour');
  }
  const hour = value.getHours();
  const minute = value.getMinutes();
  const hand = part === 'hour'
    ? { angle: DatePicking.hourPlace(hour).angle, length: DatePicking.hourPlace(hour).inner ? INNER : OUTER }
    : { angle: DatePicking.minuteAngle(minute), length: OUTER };

  const mark = (label: string, angle: number, radius: number, selected: boolean, onPress: () => void, spoken: string, small = false) => {
    const p = DatePicking.point(angle, radius);
    return (
      <Pressable
        key={`${radius}-${label}`}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected }}
        style={[styles.mark, { left: DIAL / 2 + p.x - MARK / 2, top: DIAL / 2 + p.y - MARK / 2 }, selected && { backgroundColor: theme.accent }]}
      >
        <Txt type={small ? 'footnote' : 'callout'} color={selected ? theme.onAccent : small ? theme.inkSecondary : theme.ink}>{label}</Txt>
      </Pressable>
    );
  };

  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={styles.readout}>
        <Segment text={pad(hour)} active={part === 'hour'} onPress={() => setPart('hour')} label="Hour" />
        <Txt type="largeTitle" color={theme.inkSecondary}>:</Txt>
        <Segment text={pad(minute)} active={part === 'minute'} onPress={() => setPart('minute')} label="Minutes" />
      </View>
      <View style={[styles.dial, { backgroundColor: theme.raised }]}>
        {/* The hand: from the centre to the chosen mark. */}
        <View pointerEvents="none" style={[styles.handFrame, { height: hand.length * 2, top: DIAL / 2 - hand.length, transform: [{ rotate: `${hand.angle}deg` }] }]}>
          <View style={[styles.hand, { backgroundColor: withAlpha(theme.accent, 0.6) }]} />
        </View>
        <View pointerEvents="none" style={[styles.pivot, { backgroundColor: theme.accent }]} />
        {part === 'hour'
          ? [
              ...DatePicking.hours.outer.map((h) => mark(String(h), DatePicking.hourPlace(h).angle, OUTER, h === hour, () => {
                onChange(DatePicking.withTime(value, h, minute));
                setPart('minute');
              }, `${pad(h)}:00`)),
              ...DatePicking.hours.inner.map((h) => mark(pad(h), DatePicking.hourPlace(h).angle, INNER, h === hour, () => {
                onChange(DatePicking.withTime(value, h, minute));
                setPart('minute');
              }, `${pad(h)}:00`, true)),
            ]
          : DatePicking.minutes.map((m) => mark(pad(m), DatePicking.minuteAngle(m), OUTER, m === minute, () => {
              onChange(DatePicking.withTime(value, hour, m));
            }, `${m} minutes past`))}
      </View>
      <View style={styles.done}>
        <PrimaryButton title="Done" onPress={onClose} />
      </View>
    </BottomCard>
  );
}

function Segment({ text, active, onPress, label }: { text: string; active: boolean; onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${text}`}
      accessibilityState={{ selected: active }}
      style={[styles.segment, { backgroundColor: active ? withAlpha(theme.accent, 0.18) : 'transparent' }]}
    >
      <Txt type="largeTitle" color={active ? theme.accent : theme.ink}>{text}</Txt>
    </Pressable>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Space.s },
  monthStep: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Space.xxs },
  weekday: { width: CELL, textAlign: 'center' },
  cell: { width: CELL, height: CELL },
  day: { borderRadius: CELL / 2, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '700' },
  readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, marginBottom: Space.l },
  segment: { borderRadius: Radius.control, paddingHorizontal: Space.s, paddingVertical: Space.xxs },
  dial: { width: DIAL, height: DIAL, borderRadius: DIAL / 2, alignSelf: 'center' },
  handFrame: { position: 'absolute', left: DIAL / 2 - 1, width: 2 },
  hand: { flex: 0.5, width: 2 },
  pivot: { position: 'absolute', left: DIAL / 2 - 4, top: DIAL / 2 - 4, width: 8, height: 8, borderRadius: 4 },
  mark: { position: 'absolute', width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: 'center', justifyContent: 'center' },
  done: { marginTop: Space.l },
});
