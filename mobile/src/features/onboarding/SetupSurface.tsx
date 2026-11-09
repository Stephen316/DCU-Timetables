import { ReactNode, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPreviewServices } from '../../data/preview';
import type { Services } from '../../data/services';
import { MemoryKV } from '../../data/storage';
import { ServicesContext } from '../../state/hooks';
import { RootProvider } from '../../state/root';
import { Space, useTheme } from '../../ui/theme';
import { TimetableScreen } from '../week/TimetableScreen';

/** An isolated sample timetable behind setup, before the student's programme is known. */
export function SetupSurface({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [background, setBackground] = useState<Services | null>(null);

  useEffect(() => {
    let active = true;
    void createPreviewServices(new MemoryKV(), null).then((services) => {
      if (active) setBackground(services);
    });
    return () => { active = false; };
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      {background ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <ServicesContext.Provider value={background}>
            <RootProvider>
              <TimetableScreen mode="day" />
            </RootProvider>
          </ServicesContext.Provider>
        </View>
      ) : null}
      <ScrollView
        style={styles.scrim}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.l, paddingBottom: insets.bottom + Space.l }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Space.l },
});
