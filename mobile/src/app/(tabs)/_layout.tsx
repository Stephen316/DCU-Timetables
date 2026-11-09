import { Tabs } from 'expo-router';
import { useState } from 'react';
import { MacShell } from '../../data/macShell';
import { TabBar } from '../../features/week/TabBar';
import { Icon } from '../../ui/components';

/**
 * The signed-in app: Day, Week, Deadlines and Account along the bottom, sharing one week
 * model. The Mac app has no day view, so there the first tab is the week and the Week tab is
 * left off the bar.
 */
export default function TabsLayout() {
  const [onMac] = useState(() => MacShell.isPresent());
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{ title: onMac ? 'Week' : 'Day', tabBarIcon: ({ color, size }) => <Icon name={onMac ? 'calendar' : 'today'} color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="week"
        options={{ title: 'Week', href: onMac ? null : undefined, tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="deadlines"
        options={{ title: 'Deadlines', tabBarIcon: ({ color, size }) => <Icon name="checklist" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarShowLabel: false, tabBarIcon: ({ color, size }) => <Icon name="account" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
