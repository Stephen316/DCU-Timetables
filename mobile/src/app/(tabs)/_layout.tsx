import { Tabs } from 'expo-router';
import { useState } from 'react';
import { MacShell } from '../../data/macShell';
import { TabBar } from '../../features/week/TabBar';
import { Icon } from '../../ui/components';
import { DesktopRail, useDesktopRail } from '../../ui/floatingBar';

/**
 * The signed-in app: Today, This week, Deadlines and Account, sharing one week model. On a
 * phone they sit along the bottom; on a desktop-wide window they stand down the right edge,
 * named when the cursor rests on one. The Mac app has no day view, so there the first tab is
 * the week and the separate week tab is left off the bar.
 */
export default function TabsLayout() {
  const [onMac] = useState(() => MacShell.isPresent());
  const rail = useDesktopRail();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: rail ? { marginRight: DesktopRail.width } : undefined }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{ title: onMac ? 'This week' : 'Today', tabBarIcon: ({ color, size }) => <Icon name={onMac ? 'calendar' : 'today'} color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="week"
        options={{ title: 'This week', href: onMac ? null : undefined, tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
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
