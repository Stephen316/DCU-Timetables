import { Children, ReactNode, Ref, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconName, Txt, useLargeText, useWide } from '../../ui/components';
import { Desktop, MIN_TARGET, Radius, Space, useTheme } from '../../ui/theme';

export type SettingsTab = 'settings' | 'account' | 'notifications' | 'export';
const tabs: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'settings', label: 'Settings', icon: 'contrast' },
  { id: 'account', label: 'Account', icon: 'person' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'export', label: 'Export', icon: 'calendar' },
];

// kit-design: composed from the established Notra-themed app Icon, Txt and Pressable controls.
export function SettingsLayout({ selected, onSelect, children }: {
  selected: SettingsTab; onSelect: (tab: SettingsTab) => void; children: ReactNode;
}) {
  const theme = useTheme();
  const wide = useWide();
  const large = useLargeText();
  const controls = useRef<Partial<Record<SettingsTab, View | null>>>({});
  const move = (key: string, current: SettingsTab) => {
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1
      : ['ArrowRight', 'ArrowDown'].includes(key) ? (index + 1) % tabs.length
        : ['ArrowLeft', 'ArrowUp'].includes(key) ? (index + tabs.length - 1) % tabs.length : null;
    if (next === null) return false;
    onSelect(tabs[next].id);
    controls.current[tabs[next].id]?.focus();
    return true;
  };
  return (
    <View style={[styles.layout, wide && styles.wide]}>
      <View accessibilityRole="tablist" accessibilityLabel="Account settings" style={[
        styles.navigation, wide ? styles.sidebar : styles.mobileNavigation,
        { borderColor: theme.separator },
      ]}>
        {tabs.map((tab) => (
          <SettingsTabButton key={tab.id} {...tab} selected={selected === tab.id} compact={!wide && !large} onPress={() => onSelect(tab.id)}
            controlRef={(node) => { controls.current[tab.id] = node; }} onKey={(key) => move(key, tab.id)} />
        ))}
      </View>
      <View nativeID="settings-panel" role="tabpanel" accessibilityLabel={tabs.find((tab) => tab.id === selected)?.label} style={styles.content}>
        {children}
      </View>
    </View>
  );
}

function SettingsTabButton({ label, icon, selected, compact, onPress, controlRef, onKey }: {
  label: string; icon: IconName; selected: boolean; compact: boolean; onPress: () => void;
  controlRef: Ref<View>; onKey: (key: string) => boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable ref={controlRef} {...(Platform.OS === 'web' ? {
      tabIndex: selected ? 0 : -1,
      'aria-selected': selected,
      'aria-controls': 'settings-panel',
      onKeyDown: (event: React.KeyboardEvent) => { if (onKey(event.key)) event.preventDefault(); },
    } : {})} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }}
      onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.tab, compact && styles.compactTab, {
        backgroundColor: selected || pressed ? theme.raised : theme.canvas,
        borderColor: focused ? theme.accent : selected ? theme.separator : theme.canvas,
      }]}>
      <Icon name={icon} color={selected ? theme.accent : theme.inkSecondary} />
      <Txt type="footnote" color={selected ? theme.ink : theme.inkSecondary} style={styles.label}>{label}</Txt>
    </Pressable>
  );
}

export function SettingsIntro({ title, description }: { title: string; description: string }) {
  const theme = useTheme();
  return <View style={styles.intro}>
    <Txt type="title3" accessibilityRole="header">{title}</Txt>
    <Txt type="subheadline" color={theme.inkSecondary}>{description}</Txt>
  </View>;
}

// kit-design: adapted from the app's Section, grouping related rows in one shared surface.
export function SettingsSection({ header, footer, children }: { header?: string; footer?: string; children?: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return <View style={styles.section}>
    {header ? <Txt type="headline" accessibilityRole="header">{header}</Txt> : null}
    {rows.length ? <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      {rows.map((row, index) => <View key={index} style={index ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.separator } : undefined}>{row}</View>)}
    </View> : null}
    {footer ? <Txt type="footnote" color={theme.inkSecondary}>{footer}</Txt> : null}
  </View>;
}

const styles = StyleSheet.create({
  layout: { flex: 1, minHeight: 0, width: '100%', maxWidth: Desktop.readable + Desktop.dialog, alignSelf: 'center' },
  wide: { flexDirection: 'row', paddingHorizontal: Space.xl, paddingTop: Space.l },
  navigation: { gap: Space.xs, padding: Space.s },
  sidebar: { width: Desktop.dialog / 2, borderRightWidth: StyleSheet.hairlineWidth, paddingRight: Space.l },
  mobileNavigation: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: Space.s, padding: Space.m, borderRadius: Radius.control, borderWidth: Space.xxs },
  compactTab: { flex: 1, flexDirection: 'column', paddingHorizontal: Space.xxs, gap: Space.xs },
  label: { fontWeight: '600' },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  intro: { marginHorizontal: Space.l, paddingTop: Space.xl, paddingBottom: Space.s, gap: Space.s },
  section: { marginHorizontal: Space.l, marginTop: Space.xl, gap: Space.m },
  group: { borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
