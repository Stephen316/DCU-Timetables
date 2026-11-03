import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DatePicking } from '../../core/datePicking';
import { formatTime, formatWeekdayDayMonth, isSameDay, monthName, startOfDay, weekdayName } from '../../core/time';
import { BottomCard, Icon, InlineAction, PrimaryButton, Txt } from '../../ui/components';
import { TimeWheel } from '../../ui/TimeWheel';
import { Space, useTheme } from '../../ui/theme';

/**
 * The due date and the time as two chips on one line, each opening a popup: a month
 * calendar for the day, hour and minute wheels for the time. The same on the phone, in a browser
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
      <TimeCard visible={open === 'time'} value={value} onChange={onChange} onClose={() => setOpen(null)} />
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

/**
 * The time on two wheels, hour and minute, as Clock sets an alarm. The day it's for heads
 * the card, since the chip that opened it is now hidden. Each turn applies straight away.
 */
function TimeCard({ visible, value, onChange, onClose }: {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Txt type="headline" accessibilityRole="header" style={styles.timeTitle}>{formatWeekdayDayMonth(value)}</Txt>
      <TimeWheel
        hours={value.getHours()}
        minutes={value.getMinutes()}
        onChange={(h, m) => onChange(DatePicking.withTime(value, h, m))}
      />
      <View style={styles.done}>
        <PrimaryButton title="Done" onPress={onClose} />
      </View>
    </BottomCard>
  );
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
  timeTitle: { textAlign: 'center', marginBottom: Space.m },
  done: { marginTop: Space.l },
});
