import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, isValidElement, ReactNode, useRef } from 'react';
import {
  ActivityIndicator, ColorValue, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Switch,
  Text, TextProps, TextStyle, View, ViewStyle, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TARGET, Radius, Space, Type, useTheme } from './theme';

// MARK: - Icons

/**
 * The app's symbol vocabulary, named for what it means. Mapped onto Ionicons, standing in
 * for the SF Symbols the iOS app used.
 */
const ICONS = {
  calendar: 'calendar-outline',
  list: 'list-outline',
  checklist: 'list',
  alert: 'alert-circle',
  warning: 'warning',
  assignment: 'document-text-outline',
  labReport: 'flask-outline',
  quiz: 'clipboard-outline',
  exam: 'school-outline',
  presentation: 'people-outline',
  other: 'calendar-clear-outline',
  test: 'clipboard-outline',
  moved: 'arrow-redo-outline',
  groups: 'people-outline',
  person: 'person-outline',
  account: 'person-circle-outline',
  more: 'ellipsis-horizontal-circle-outline',
  back: 'chevron-back',
  forward: 'chevron-forward',
  place: 'location-outline',
  video: 'videocam-outline',
  undo: 'arrow-undo-outline',
  add: 'add-circle-outline',
  flag: 'flag-outline',
  hide: 'eye-off-outline',
  show: 'eye-outline',
  copy: 'copy-outline',
  check: 'checkmark',
  unconfirmed: 'help-circle-outline',
  confirmed: 'ribbon',
  report: 'chatbubble-ellipses',
  reportOutline: 'chatbubble-ellipses-outline',
  cancelled: 'close-circle',
  running: 'checkmark-circle',
  runningOutline: 'checkmark-circle-outline',
  search: 'search',
  signOut: 'log-out-outline',
  labs: 'construct-outline',
  swap: 'swap-horizontal-outline',
  idCard: 'id-card-outline',
  offline: 'cloud-offline-outline',
  notAttending: 'person-remove-outline',
  done: 'checkmark-done-circle',
  delete: 'trash-outline',
  close: 'close',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const theme = useTheme();
  return <Ionicons name={ICONS[name]} size={size} color={color ?? theme.ink} />;
}

// MARK: - Text

type TypeStyle = keyof typeof Type;

export function Txt({
  type = 'body', color, style, ...rest
}: TextProps & { type?: TypeStyle; color?: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return <Text {...rest} style={[Type[type], { color: color ?? theme.ink }, style]} />;
}

/** An icon and its words, as one line — SwiftUI's `Label`. */
export function Label({
  icon, text, color, type = 'body', style,
}: { icon: IconName; text: string; color?: string; type?: TypeStyle; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const fontSize = (Type[type] as TextStyle).fontSize ?? 17;
  return (
    <View style={[styles.label, style]}>
      <Icon name={icon} size={fontSize + 1} color={color ?? theme.ink} />
      <Txt type={type} color={color} style={styles.flexText}>{text}</Txt>
    </View>
  );
}

// MARK: - Layout

/**
 * The accessibility text sizes. Rows that sit side by side at default size stack at these,
 * rather than clipping a title to a few letters.
 */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= 1.35;
}

/** Lays out side by side, and stacks once the text is one of the accessibility sizes. */
export function AdaptiveStack({ children, gap = Space.s, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  const large = useLargeText();
  return (
    <View style={[large ? styles.stackColumn : styles.stackRow, { gap }, style]}>{children}</View>
  );
}

/** A grouped list on the app's canvas. */
export function ListScroll({
  children, refreshing, onRefresh, contentStyle, footer,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned under the list, over the canvas — a summary that stays while the list scrolls. */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.listContent, { paddingBottom: Space.xxl + (footer ? 0 : insets.bottom) }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.inkSecondary} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/**
 * A group of rows on the slate surface with slate hairlines, and optional words above and
 * below. `bare` puts the rows straight on the canvas — an introduction, or a button that
 * stands on its own.
 */
export function Section({
  header, footer, children, bare,
}: { header?: string; footer?: ReactNode; children?: ReactNode; bare?: boolean }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  if (rows.length === 0 && !header && !footer) return null;
  return (
    <View style={styles.section}>
      {header ? (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.sectionHeader} accessibilityRole="header">
          {header.toUpperCase()}
        </Txt>
      ) : null}
      {rows.length > 0 ? (
        <View style={bare ? undefined : [styles.card, { backgroundColor: theme.surface }]}>
          {rows.map((row, i) => (
            <View key={isValidElement(row) && row.key != null ? row.key : i}>
              {i > 0 && !bare ? <View style={[styles.hairline, { backgroundColor: theme.separator }]} /> : null}
              {row}
            </View>
          ))}
        </View>
      ) : null}
      {footer ? (
        typeof footer === 'string' ? (
          <Txt type="footnote" color={theme.inkSecondary} style={styles.sectionFooter}>{footer}</Txt>
        ) : (
          <View style={styles.sectionFooter}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

/** One row. Tappable when it has an `onPress`, lifting onto the raised slate while pressed. */
export function Row({
  children, onPress, disabled, style, accessibilityLabel, accessibilityHint,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  if (!onPress) return <View style={[styles.row, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.raised }, disabled && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

/** A tappable row that reads as an action: accent (or destructive) text, optional icon. */
export function ActionRow({
  title, icon, onPress, destructive, disabled, busy,
}: { title: string; icon?: IconName; onPress: () => void; destructive?: boolean; disabled?: boolean; busy?: boolean }) {
  const theme = useTheme();
  const color = destructive ? theme.destructive : theme.accent;
  return (
    <Row onPress={onPress} disabled={disabled || busy} accessibilityLabel={title}>
      <View style={styles.rowLine}>
        {icon ? <Label icon={icon} text={title} color={color} /> : <Txt color={color}>{title}</Txt>}
        {busy ? <ActivityIndicator color={theme.inkSecondary} /> : null}
      </View>
    </Row>
  );
}

/** "Name ……… Stephen Harcourt" */
export function LabeledRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Row>
      <View style={styles.labeled}>
        <Txt>{label}</Txt>
        <Txt color={theme.inkSecondary} style={styles.labeledValue} selectable>{value}</Txt>
      </View>
    </Row>
  );
}

export function ToggleRow({ value, onChange, children }: { value: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Row>
      <View style={styles.rowLine}>
        <View style={styles.fill}>{children}</View>
        <Switch
          value={value}
          onValueChange={onChange}
          // Accent, not system green: green means "confirmed" everywhere else in the app.
          trackColor={{ true: theme.accent, false: theme.raised }}
          // White thumbs everywhere, as iOS draws them; Android and the web tint theirs otherwise.
          thumbColor={Platform.OS === 'ios' ? undefined : '#FFFFFF'}
          {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
        />
      </View>
    </Row>
  );
}

// MARK: - Buttons

/**
 * The one action a screen is for: sign in, continue, report it. Full width, filled. The
 * fill is a parameter so reporting a class cancelled is filled with the cancellation orange.
 */
export function PrimaryButton({
  title, onPress, disabled, busy, fill, foreground,
}: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; fill?: string; foreground?: string }) {
  const theme = useTheme();
  const fg = foreground ?? (fill ? '#FFFFFF' : theme.onAccent);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      // Disabled drops the whole control, text and fill together.
      style={({ pressed }) => [
        styles.bigButton,
        { backgroundColor: fill ?? theme.accent, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Txt type="headline" color={fg} style={styles.centerText}>{title}</Txt>
    </Pressable>
  );
}

/** The alternative to a primary action — "Not now". Same shape, quieter fill. */
export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.bigButton, { backgroundColor: theme.raised, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      <Txt color={theme.ink} style={styles.centerText}>{title}</Txt>
    </Pressable>
  );
}

/**
 * A small inline action inside a row, such as "This is right" on a deadline. The chip is
 * sized to its words; the hit area is padded out to 44pt so a thumb can find it.
 */
export function InlineAction({ title, onPress, tint, disabled }: { title: string; onPress: () => void; tint?: string; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [styles.inlineTarget, { opacity: pressed ? 0.6 : disabled ? 0.4 : 1 }]}
    >
      <View style={[styles.inlineChip, { backgroundColor: theme.raised }]}>
        <Txt type="footnote" color={tint ?? theme.accent} style={styles.medium}>{title}</Txt>
      </View>
    </Pressable>
  );
}

/** A plain text button for a header bar: "Done", "Cancel". */
export function BarButton({ title, onPress, disabled, bold }: { title: string; onPress: () => void; disabled?: boolean; bold?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={10} style={styles.barButton}>
      <Txt color={theme.accent} style={[bold && styles.semibold, disabled && styles.disabled]}>{title}</Txt>
    </Pressable>
  );
}

export function IconButton({
  icon, onPress, label, disabled, color, size = 22,
}: { icon: IconName; onPress: () => void; label: string; disabled?: boolean; color?: string; size?: number }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={size} color={color ?? theme.accent} />
    </Pressable>
  );
}

// MARK: - Controls

/** A segmented control, for a few mutually exclusive choices. */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.raised }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && [styles.segmentSelected, { backgroundColor: theme.surface }]]}
          >
            <Txt type="subheadline" style={selected ? styles.semibold : undefined}>{option.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Spinner({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.spinner}>
      <ActivityIndicator color={theme.inkSecondary} />
      {label ? <Txt type="subheadline" color={theme.inkSecondary}>{label}</Txt> : null}
    </View>
  );
}

/** Nothing to show, said plainly — `ContentUnavailableView`. */
export function EmptyState({
  icon, title, message, action,
}: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={44} color={theme.inkSecondary} />
      <Txt type="title3" style={styles.centerText}>{title}</Txt>
      {message ? <Txt type="subheadline" color={theme.inkSecondary} style={styles.centerText}>{message}</Txt> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

// MARK: - Sheets

/**
 * A full sheet with its own header bar — "Your groups", "Account". A page sheet on iOS,
 * full screen elsewhere.
 */
export function Sheet({
  visible, title, onClose, left, right, children, dismissable = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** False while something is saving, so a swipe can't close it mid-write. */
  dismissable?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={() => dismissable && onClose()}
    >
      <View style={[styles.fill, { backgroundColor: theme.canvas, paddingTop: Platform.OS === 'ios' ? 0 : insets.top }]}>
        <View style={[styles.sheetBar, { borderBottomColor: theme.separator }]}>
          <View style={styles.sheetBarSide}>{left}</View>
          <Txt type="headline" numberOfLines={1} style={styles.sheetTitle} accessibilityRole="header">{title}</Txt>
          <View style={[styles.sheetBarSide, styles.sheetBarRight]}>{right}</View>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** A card that rises from the bottom over a dimmed screen: questions and short choices. */
export function BottomCard({
  visible, onClose, children, dismissable = true, onDismissed,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  dismissable?: boolean;
  /** iOS: once the card has finished going away. */
  onDismissed?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => dismissable && onClose()} onDismiss={onDismissed}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismissable && onClose()} accessibilityLabel="Close" />
        <View style={[styles.bottomCard, { backgroundColor: theme.surface, paddingBottom: Space.xl + insets.bottom }]}>
          <View style={[styles.grabber, { backgroundColor: theme.rail }]} />
          <ScrollView bounces={false} contentContainerStyle={styles.bottomCardContent}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * A confirmation step drawn in the app's own idiom: the orange that means "reported
 * cancelled" everywhere else, and a button that repeats the action rather than saying OK.
 * Dismisses before running the action, so a slow network never looks like a dead button.
 */
export function ConfirmSheet({
  visible, title, message, confirmTitle, icon, tint, fill, onConfirm, onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmTitle: string;
  icon: IconName;
  tint: string;
  fill?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={styles.confirmBody}>
        <Icon name={icon} size={30} color={tint} />
        <Txt type="headline" style={styles.centerText}>{title}</Txt>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.centerText}>{message}</Txt>
      </View>
      <View style={styles.buttonStack}>
        <PrimaryButton title={confirmTitle} fill={fill} onPress={() => { onClose(); onConfirm(); }} />
        <SecondaryButton title="Not now" onPress={onClose} />
      </View>
    </BottomCard>
  );
}

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/** A short list of choices with an optional question above them — a menu or a dialog. */
export function ActionSheet({
  visible, title, message, actions, onClose,
}: { visible: boolean; title?: string; message?: string; actions: SheetAction[]; onClose: () => void }) {
  const theme = useTheme();
  // iOS ignores a modal presented while another is still animating away, and an action here
  // often opens one (a sheet, or the next question). So on iOS the action waits for this
  // card to finish dismissing, with a fallback in case that callback never comes.
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };
  const choose = (action: SheetAction) => {
    if (Platform.OS === 'ios') {
      pending.current = action.onPress;
      onClose();
      setTimeout(runPending, 700);
    } else {
      onClose();
      action.onPress();
    }
  };
  return (
    <BottomCard visible={visible} onClose={onClose} onDismissed={runPending}>
      {title || message ? (
        <View style={styles.actionHeader}>
          {title ? <Txt type="headline" style={styles.centerText}>{title}</Txt> : null}
          {message ? <Txt type="footnote" color={theme.inkSecondary} style={styles.centerText}>{message}</Txt> : null}
        </View>
      ) : null}
      <View style={[styles.card, { backgroundColor: theme.raised }]}>
        {actions.map((action, i) => (
          <View key={action.label}>
            {i > 0 ? <View style={[styles.hairline, { backgroundColor: theme.separator }]} /> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => choose(action)}
              style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.6 }]}
            >
              {action.icon ? (
                <Label icon={action.icon} text={action.label} color={action.destructive ? theme.destructive : theme.accent} />
              ) : (
                <Txt color={action.destructive ? theme.destructive : theme.accent}>{action.label}</Txt>
              )}
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.buttonStack}>
        <SecondaryButton title="Cancel" onPress={onClose} />
      </View>
    </BottomCard>
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  flexText: { flexShrink: 1 },
  label: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  stackRow: { flexDirection: 'row', alignItems: 'center' },
  stackColumn: { flexDirection: 'column', alignItems: 'flex-start' },
  listContent: { paddingTop: Space.s },
  section: { marginHorizontal: Space.l, marginTop: Space.l },
  sectionHeader: { marginBottom: Space.xs + 2, marginHorizontal: Space.l },
  sectionFooter: { marginTop: Space.xs + 2, marginHorizontal: Space.l },
  card: { borderRadius: 10, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: Space.l },
  row: { minHeight: MIN_TARGET, paddingHorizontal: Space.l, paddingVertical: Space.m - 1, justifyContent: 'center' },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  labeled: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.m, flexWrap: 'wrap' },
  labeledValue: { flexShrink: 1, textAlign: 'right' },
  disabled: { opacity: 0.4 },
  bigButton: {
    minHeight: MIN_TARGET, borderRadius: Radius.control, paddingHorizontal: Space.l, paddingVertical: Space.m,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.s, alignSelf: 'stretch',
  },
  centerText: { textAlign: 'center' },
  inlineTarget: { minHeight: MIN_TARGET, justifyContent: 'center' },
  inlineChip: { borderRadius: Radius.control, paddingHorizontal: Space.m, paddingVertical: Space.xs + Space.xxs },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  barButton: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: Space.xs },
  iconButton: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: Radius.control, padding: 2 },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.control - 2, paddingHorizontal: Space.s },
  segmentSelected: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  spinner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.s, padding: Space.xl },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.s, padding: Space.xxl },
  emptyAction: { marginTop: Space.m },
  sheetBar: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: Space.l, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBarSide: { flex: 1, flexDirection: 'row' },
  sheetBarRight: { justifyContent: 'flex-end' },
  sheetTitle: { flex: 2, textAlign: 'center' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  bottomCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: Space.xl, maxHeight: '85%' },
  bottomCardContent: { gap: Space.l },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: Space.s, marginBottom: Space.l },
  confirmBody: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  buttonStack: { gap: Space.s },
  actionHeader: { gap: Space.xs, alignItems: 'center' },
  actionRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: Space.l },
});
