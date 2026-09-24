import { Tabs } from 'expo-router';
import { Icon } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/** The signed-in app: the timetable and the deadlines list, sharing one week model. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.inkSecondary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.separator },
      }}
    >
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
