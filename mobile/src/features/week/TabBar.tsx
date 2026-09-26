import { Tabs } from 'expo-router';
import { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useModel } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { IconButton, Txt } from '../../ui/components';
import { MIN_TARGET, Radius, Space, useTheme } from '../../ui/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The two tabs in an outlined box on the canvas, with the week arrows either side of it on
 * the timetable. The deadlines tab keeps the arrows' space empty so the box doesn't shift.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const theme = useTheme();
  const model = useModel(useWeekModel());
  const onTimetable = state.routes[state.index]?.name === 'index';

  return (
    <View style={[styles.bar, { backgroundColor: theme.canvas, paddingBottom: Math.max(insets.bottom, Space.s) }]}>
      <View style={styles.side}>
        {/* Disabled at each end of the year rather than silently doing nothing. */}
        {onTimetable ? (
          <IconButton icon="back" label="Previous week" disabled={!model.canStep(-1)} onPress={() => model.stepIndex(-1)} />
        ) : null}
      </View>

      <View style={[styles.box, { borderColor: theme.accent, backgroundColor: theme.canvas }]} accessibilityRole="tablist">
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = state.index === i;
          const color = focused ? theme.accent : theme.inkSecondary;
          const title = options.title ?? route.name;
          const press = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              onPress={press}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected: focused }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.6 : 1 }]}
            >
              {options.tabBarIcon?.({ focused, color, size: 20 })}
              <Txt type="caption2" color={color} style={focused ? styles.semibold : undefined}>{title}</Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.side}>
        {onTimetable ? (
          <IconButton icon="forward" label="Next week" disabled={!model.canStep(1)} onPress={() => model.stepIndex(1)} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.s, paddingTop: Space.xs },
  side: { width: MIN_TARGET, alignItems: 'center' },
  box: {
    flex: 1,
    flexDirection: 'row',
    marginHorizontal: Space.s,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  tab: { flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.xs, gap: Space.xxs },
  semibold: { fontWeight: '600' },
});
