import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, isValidElement, ReactNode, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, ColorValue, Easing, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Switch,
  Text, TextProps, TextStyle, View, ViewStyle, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Desktop, MIN_TARGET, Radius, Space, Type, useTheme } from './theme';

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
  person: 'person-outline',
  account: 'person-circle-outline',
  bell: 'notifications-outline',
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
  swap: 'swap-horizontal-outline',
  idCard: 'id-card-outline',
  offline: 'cloud-offline-outline',
  remove: 'remove-circle-outline',
  done: 'checkmark-done-circle',
  delete: 'trash-outline',
  edit: 'create-outline',
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
/** The system's Reduce Motion setting, kept current. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= 1.35;
}

/** A desktop-sized window: wider than any phone, so sheets float rather than fill it. */
export function useWide(): boolean {
  return useWindowDimensions().width >= Desktop.wide;
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
        contentContainerStyle={[styles.listContent, styles.readable, { paddingBottom: Space.xxl + (footer ? 0 : insets.bottom) }, contentStyle]}
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

/**
 * A segmented control, for a few mutually exclusive choices — drawn as the tab bar is: an
 * accent outline around the chosen segment that slides to the next one.
 */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const segmentWidth = options.length > 0 ? width / options.length : 0;
  const index = Math.max(options.findIndex((option) => option.value === value), 0);
  const [offset] = useState(() => new Animated.Value(0));
  const lastWidth = useRef(0);

  // A new width is a layout, not a move: jump there. A new choice slides.
  useEffect(() => {
    const target = index * segmentWidth;
    if (lastWidth.current !== segmentWidth) {
      lastWidth.current = segmentWidth;
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, { toValue: target, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [index, segmentWidth, offset]);

  // As the tab bar: white reads on the dark canvas, but would vanish on Solarized Light's cream.
  const selectedInk = theme.scheme === 'dark' ? '#FFFFFF' : theme.ink;

  return (
    <View
      style={styles.segmented}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentOutline, { width: segmentWidth, borderColor: theme.accent, transform: [{ translateX: offset }] }]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.segment, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Txt type="subheadline" color={selected ? selectedInk : theme.inkSecondary} style={selected ? styles.semibold : undefined}>
              {option.label}
            </Txt>
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
/**
 * Diagonal lines across whatever it's laid over — how an online class is marked. It sits
 * behind the content and takes no touches.
 *
 * The lines sit at fixed places on the page, not on this view: `origin` is where this view
 * is in a frame it shares with its neighbours, so two online classes back to back read as
 * one run of lines rather than two that meet out of step.
 */
export function Hatch({ color, spacing, thickness = 1, angle = -35, origin = { x: 0, y: 0 }, style }: {
  color: string;
  /** Distance between lines, measured across them. */
  spacing: number;
  thickness?: number;
  angle?: number;
  origin?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A square as wide as the diagonal still covers the area once it's rotated.
  const side = Math.ceil(Math.hypot(size.width, size.height));
  // How far this view's centre is across the lines, in the shared frame; the first line goes
  // where that puts it back in step with the page.
  const radians = (angle * Math.PI) / 180;
  const across = (origin.x + size.width / 2) * -Math.sin(radians) + (origin.y + size.height / 2) * Math.cos(radians);
  const first = (((side / 2 - across) % spacing) + spacing) % spacing;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.hatch, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.width || height !== size.height) setSize({ width, height });
      }}
    >
      {side > 0 ? (
        <View style={{
          position: 'absolute', width: side, height: side,
          left: (size.width - side) / 2, top: (size.height - side) / 2,
          transform: [{ rotate: `${angle}deg` }],
        }}>
          {Array.from({ length: Math.ceil((side - first) / spacing) }, (_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, width: side, top: first + i * spacing, height: thickness, backgroundColor: color }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A small blue "!" on a class that has something due at it. A mark of its own rather than
 * the kind's icon, so one shape means "a deadline is here" at every size, the grid included.
 */
export function DeadlineMark({ size = 16 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.deadlineMark, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.tint.test }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[styles.deadlineMarkText, { fontSize: size * 0.72, lineHeight: size }]} allowFontScaling={false}>!</Text>
    </View>
  );
}

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
  visible, title, onClose, onDismissed, left, right, children, dismissable = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Once it has finished sliding away (iOS), for work that should happen in view. */
  onDismissed?: () => void;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** False while something is saving, so a swipe can't close it mid-write. */
  dismissable?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const content = (
    <>
      <View style={[styles.sheetBar, { borderBottomColor: theme.separator }]}>
        <View style={styles.sheetBarSide}>{left}</View>
        <Txt type="headline" numberOfLines={1} style={styles.sheetTitle} accessibilityRole="header">{title}</Txt>
        <View style={[styles.sheetBarSide, styles.sheetBarRight]}>{right}</View>
      </View>
      {children}
    </>
  );
  // A desktop window: a panel over the dimmed app, as a Mac app's sheet sits over its window.
  if (wide && Platform.OS === 'web') {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => dismissable && onClose()} onDismiss={onDismissed}>
        <View style={[styles.scrim, styles.centred]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => dismissable && onClose()} accessibilityLabel="Close" />
          <View style={[styles.panel, { backgroundColor: theme.canvas, borderColor: theme.separator }]}>{content}</View>
        </View>
      </Modal>
    );
  }
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={() => dismissable && onClose()}
      onDismiss={onDismissed}
    >
      <View style={[styles.fill, { backgroundColor: theme.canvas, paddingTop: Platform.OS === 'ios' ? 0 : insets.top }]}>
        {content}
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
  // In a desktop window the card is a dialog in the middle, not a tray at the far bottom.
  const wide = useWide();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => dismissable && onClose()} onDismiss={onDismissed}>
      <View style={[styles.scrim, wide && styles.centred]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismissable && onClose()} accessibilityLabel="Close" />
        <View
          style={[
            styles.bottomCard,
            { backgroundColor: theme.surface, paddingBottom: Space.xl + (wide ? 0 : insets.bottom) },
            wide && styles.dialog,
          ]}
        >
          {wide ? <View style={styles.dialogTop} /> : <View style={[styles.grabber, { backgroundColor: theme.rail }]} />}
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
  hatch: { overflow: 'hidden' },
  fill: { flex: 1 },
  flexText: { flexShrink: 1 },
  label: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  stackRow: { flexDirection: 'row', alignItems: 'center' },
  stackColumn: { flexDirection: 'column', alignItems: 'flex-start' },
  listContent: { paddingTop: Space.s },
  readable: { width: '100%', maxWidth: Desktop.readable, alignSelf: 'center' },
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
  deadlineMark: { alignItems: 'center', justifyContent: 'center' },
  deadlineMarkText: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  semibold: { fontWeight: '600' },
  barButton: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: Space.xs },
  iconButton: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row' },
  segment: { flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.s },
  segmentOutline: { position: 'absolute', top: 0, bottom: 0, left: 0, borderWidth: 1, borderRadius: Radius.control },
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
  centred: { justifyContent: 'center', alignItems: 'center', padding: Space.xl },
  dialog: { width: '100%', maxWidth: Desktop.dialog, borderRadius: 16 },
  dialogTop: { height: Space.xl },
  panel: {
    width: '100%', maxWidth: Desktop.panel, height: '100%', maxHeight: 760, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  bottomCardContent: { gap: Space.l },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: Space.s, marginBottom: Space.l },
  confirmBody: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  buttonStack: { gap: Space.s },
  actionHeader: { gap: Space.xs, alignItems: 'center' },
  actionRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: Space.l },
});
