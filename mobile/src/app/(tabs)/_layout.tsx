import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { TabBar } from '../../features/week/TabBar';
import { Icon } from '../../ui/components';
import { DesktopRail, useDesktopRail, useRailBalance, useWeekFirst } from '../../ui/floatingBar';

/** The tabs that draw the week grid when the rail is up: the front page, and the week tab. */
const WEEK_ROUTES = new Set(['index', 'week']);

/**
 * The signed-in app: Today, This week, Deadlines and Account, sharing one week model. On a
 * phone they sit along the bottom; on a desktop-wide window they stand down the right edge,
 * named when the cursor rests on one. The Mac app and a desktop-wide window have no Today
 * tab: there the first tab is the week and the separate week tab is left off the bar.
 */
export default function TabsLayout() {
  const weekFirst = useWeekFirst();
  const rail = useDesktopRail();
  const balance = useRailBalance();
  return (
    <Tabs
      // In a browser every tab switch would otherwise add a page to its history, and on a phone
      // that history is an edge swipe: iOS slides a stale screenshot of the other tab over this
      // one while the day pager drags under the same finger. Tabs replace each other instead.
      backBehavior={Platform.OS === 'web' ? 'none' : 'firstRoute'}
      // Every screen keeps clear of the rail; the week also gives up as much on its left, so the
      // grid is centred in the window rather than in what the rail leaves of it.
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: rail ? { marginRight: DesktopRail.width, marginLeft: WEEK_ROUTES.has(route.name) ? balance : 0 } : undefined,
      })}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{ title: weekFirst ? 'This week' : 'Today', tabBarIcon: ({ color, size }) => <Icon name={weekFirst ? 'calendar' : 'today'} color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="week"
        options={{ title: 'This week', href: weekFirst ? null : undefined, tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="deadlines"
        options={{ title: 'Deadlines', tabBarIcon: ({ color, size }) => <Icon name="checklist" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarIcon: ({ color, size }) => <Icon name="account" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
