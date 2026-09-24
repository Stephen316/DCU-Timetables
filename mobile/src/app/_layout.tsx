import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createAppServices } from '../data/platform';
import { Services } from '../data/services';
import { PrefKey } from '../data/storage';
import { ServicesContext, usePref } from '../state/hooks';
import { RootProvider, useRoot } from '../state/root';
import { dark, light, ThemeContext } from '../ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [services, setServices] = useState<Services | null>(null);

  useEffect(() => {
    // Everything saved on the device is read before the first screen draws, so no screen
    // ever flashes its signed-out state on the way to the timetable.
    createAppServices()
      .then(setServices)
      .finally(() => void SplashScreen.hideAsync());
  }, []);

  if (!services) return null;
  return (
    <SafeAreaProvider>
      <ServicesContext.Provider value={services}>
        <Themed>
          <RootProvider>
            <RootStack />
          </RootProvider>
        </Themed>
      </ServicesContext.Provider>
    </SafeAreaProvider>
  );
}

/** Light, dark, or the phone's setting — chosen in Account, remembered across sign-outs. */
function Themed({ children }: { children: ReactNode }) {
  const [setting] = usePref(PrefKey.appearance);
  const system = useColorScheme();
  const scheme = setting === 'light' || setting === 'dark' ? setting : system === 'dark' ? 'dark' : 'light';
  const palette = scheme === 'dark' ? dark : light;

  // Set on the app too, so system pieces — alerts, the keyboard, date pickers — follow it.
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(setting === 'light' || setting === 'dark' ? setting : 'unspecified');
  }, [setting]);

  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.accent,
        background: palette.canvas,
        card: palette.canvas,
        text: palette.ink,
        border: palette.separator,
      },
    };
  }, [scheme, palette]);

  return (
    <ThemeContext.Provider value={palette}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}

/**
 * The timetable routes exist only once a timetable is open; until then everything goes to
 * the onboarding flow. Switching between them is a guard flip, never a navigation call.
 */
function RootStack() {
  const { flow } = useRoot();
  const inShell = flow === 'shell';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={inShell}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="class/[id]" options={{ headerShown: true, title: 'Class', headerBackTitle: 'Back' }} />
      </Stack.Protected>
      <Stack.Protected guard={!inShell}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}
