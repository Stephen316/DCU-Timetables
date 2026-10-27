import { Tabs } from 'expo-router';
import { useState } from 'react';
import { MacShell } from '../../data/macShell';
import { DESKTOP_RAIL_WIDTH, TabBar, TimetableEditProvider } from '../../features/week/TabBar';
import { Icon, useWide } from '../../ui/components';

/** The signed-in app: the timetable, the student's journal, and the deadlines list, sharing one week model. */
export default function TabsLayout() {
  const [inMacApp] = useState(() => MacShell.isPresent());
  const wide = useWide();
  const onDesktop = inMacApp || wide;

  return (
    <TimetableEditProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: onDesktop ? { marginRight: DESKTOP_RAIL_WIDTH } : undefined,
        }}
        tabBar={(props) => <TabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{ title: 'Timetable', tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="journal"
          options={{ title: 'Journal', tabBarIcon: ({ color, size }) => <Icon name="journal" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="deadlines"
          options={{ title: 'Deadlines', tabBarIcon: ({ color, size }) => <Icon name="checklist" color={color} size={size} /> }}
        />
      </Tabs>
    </TimetableEditProvider>
  );
}
