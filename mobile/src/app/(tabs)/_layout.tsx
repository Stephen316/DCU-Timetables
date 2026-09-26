import { Tabs } from 'expo-router';
import { TabBar } from '../../features/week/TabBar';
import { Icon } from '../../ui/components';

/** The signed-in app: the timetable and the deadlines list, sharing one week model. */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Timetable', tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="deadlines"
        options={{ title: 'Deadlines', tabBarIcon: ({ color, size }) => <Icon name="checklist" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
