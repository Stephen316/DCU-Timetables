import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, createContext, isValidElement, ReactNode, Ref, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, ColorValue, Easing, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Switch,
  Text, TextProps, TextStyle, View, ViewStyle, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardInset, concentric, Desktop, elevation, MIN_TARGET, Radius, screenCorner, Space, Type, useTheme, withAlpha } from './theme';
import { withShinyPlus } from './PlusWord';

// MARK: - Icons

/**
 * The app's symbol vocabulary, named for what it means. Mapped onto Ionicons, standing in
 * for the SF Symbols the iOS app used.
 */
const ICONS = {
  calendar: 'calendar-outline',
  today: 'today-outline',
  list: 'list-outline',
  checklist: 'reader-outline',
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
  dropdown: 'chevron-down',
  place: 'location-outline',
  video: 'videocam-outline',
  undo: 'arrow-undo-outline',
  add: 'add-circle-outline',
  plus: 'add',
  shield: 'shield-checkmark-outline',
  document: 'document-text-outline',
  help: 'help-buoy-outline',
  replay: 'play-circle-outline',
  contrast: 'contrast-outline',
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
  arrowUp: 'arrow-up',
  arrowDown: 'arrow-down',
  arrowLeft: 'arrow-back',
  /** A deadline that counts towards the grade. */
  graded: 'star',
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
  children, refreshing, onRefresh, contentStyle, footer, onDragChange, scrollRef, onViewport,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned under the list, over the canvas — a summary that stays while the list scrolls. */
  footer?: ReactNode;
  /** A finger on the list and off it again — the tutorial hides its card meanwhile. */
  onDragChange?: (dragging: boolean) => void;
  /** For scrolling the list to a row of its own accord. */
  scrollRef?: Ref<ScrollView>;
  /** The part of the list on screen — how far it's scrolled, and how tall the view is. */
  onViewport?: (offsetY: number, height: number) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const viewport = useRef({ offsetY: 0, height: 0 });
  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <ScrollView
        ref={scrollRef}
        onLayout={onViewport && ((e) => {
          viewport.current.height = e.nativeEvent.layout.height;
          onViewport(viewport.current.offsetY, viewport.current.height);
        })}
        onScroll={onViewport && ((e) => {
          viewport.current.offsetY = e.nativeEvent.contentOffset.y;
          onViewport(viewport.current.offsetY, viewport.current.height);
        })}
        scrollEventThrottle={onViewport ? 32 : undefined}
        style={styles.fill}
        contentContainerStyle={[styles.listContent, styles.readable, { paddingBottom: Space.xxl + (footer ? 0 : insets.bottom) }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={onDragChange && (() => onDragChange(true))}
        onScrollEndDrag={onDragChange && (() => onDragChange(false))}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.inkSecondary} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/**
 * A group of rows on a white card (Notra's: a soft shadow on light, a hairline border on
 * dark), with hairlines between them and optional words above and below. `bare` puts the rows straight on the canvas — an introduction, or a button that
 * stands on its own.
 */
export function Section({
  header, footer, children, bare,
}: { header?: string; footer?: ReactNode; children?: ReactNode; bare?: boolean }) {
  const theme = useTheme();
  const outerCorner = useContext(ButtonCorner);
  const rows = Children.toArray(children);
  if (rows.length === 0 && !header && !footer) return null;
  return (
    <View style={styles.section}>
      {header ? (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.sectionHeader} accessibilityRole="header">
          {header}
        </Txt>
      ) : null}
      {rows.length > 0 ? (
        // A bare section's buttons stand where a card would, so they curve as the cards round them do.
        <ButtonCorner.Provider value={bare ? Radius.card : outerCorner}>
          <View style={bare ? undefined : [styles.card, { backgroundColor: theme.surface }, elevation(theme)]}>
            {rows.map((row, i) => (
              <View key={isValidElement(row) && row.key != null ? row.key : i}>
                {i > 0 && !bare ? <View style={[styles.hairline, { backgroundColor: theme.separator }]} /> : null}
                {row}
              </View>
            ))}
          </View>
        </ButtonCorner.Provider>
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

/**
 * A tappable row that reads as an action. With an icon, as Notra lists its settings: the icon
 * in a tinted rounded square, the words in ink, and a chevron when it opens somewhere else.
 * Without one, the words alone in the accent, as a link. Destructive rows are red either way.
 */
export function ActionRow({
  title, icon, onPress, destructive, disabled, busy, tint, chevron, detail,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** The icon's colour, when it isn't the accent: green for "done", say. */
  tint?: string;
  /** Opens a page or a sheet, rather than doing the thing there and then. */
  chevron?: boolean;
  /** A value on the right, such as the alert time chosen. */
  detail?: string;
}) {
  const theme = useTheme();
  const color = destructive ? theme.destructive : tint ?? theme.accent;
  return (
    <Row onPress={onPress} disabled={disabled || busy} accessibilityLabel={detail ? `${title}, ${detail}` : title}>
      <View style={styles.rowLine}>
        {icon ? (
          <View style={styles.actionLead}>
            <View style={[styles.iconTile, { backgroundColor: withAlpha(color, theme.scheme === 'dark' ? 0.2 : 0.12) }]}>
              <Icon name={icon} size={17} color={color} />
            </View>
            <Txt color={destructive ? theme.destructive : theme.ink} style={styles.flexText}>{title}</Txt>
          </View>
        ) : (
          <Txt color={color} style={styles.flexText}>{title}</Txt>
        )}
        {busy ? (
          <ActivityIndicator color={theme.inkSecondary} />
        ) : detail || chevron ? (
          <View style={styles.actionTrail}>
            {detail ? <Txt type="subheadline" color={theme.inkSecondary}>{detail}</Txt> : null}
            {chevron ? <Icon name="forward" size={16} color={theme.inkTertiary} /> : null}
          </View>
        ) : null}
      </View>
    </Row>
  );
}

/** A person or a module as a round badge: initials in white on a colour. */
export function Avatar({ text, color, size = 32 }: { text: string; color: string; size?: number }) {
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]} allowFontScaling={false}>{text}</Text>
    </View>
  );
}

/**
 * A tab's title bar, the same on every tab: the title centred and bold, an optional line under
 * it, and a control either side. It sits on the canvas with no rule beneath, as Notra's pages
 * open; the cards below are what set the content apart.
 */
export function ScreenHeader({
  title, subtitle, left, right,
}: { title: string; subtitle?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screenHeader, { paddingTop: insets.top + Space.xs, backgroundColor: theme.canvas }]}>
      <View style={styles.screenHeaderSide}>{left}</View>
      <View style={styles.screenHeaderTitle}>
        <Txt type="title3" numberOfLines={1} style={styles.bold} accessibilityRole="header">{title}</Txt>
        {typeof subtitle === 'string' ? (
          <Txt type="footnote" color={theme.inkSecondary} numberOfLines={1}>{subtitle}</Txt>
        ) : subtitle ?? null}
      </View>
      <View style={[styles.screenHeaderSide, styles.screenHeaderRight]}>{right}</View>
    </View>
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
  return (
    <Row>
      <View style={styles.rowLine}>
        <View style={styles.fill}>{children}</View>
        <AppSwitch value={value} onValueChange={onChange} />
      </View>
    </Row>
  );
}

const SWITCH = { width: 51, height: 31, thumb: 27 };
const SWITCH_INSET = (SWITCH.height - SWITCH.thumb) / 2;

/**
 * The app's on/off switch: accent when on — not system green, which means "confirmed"
 * everywhere else here — with a white knob, as iOS draws it. The browser's own switch is a
 * thin Material track with the knob hanging over its ends, so the web build draws this one
 * itself; the phone keeps its native switch.
 */
export function AppSwitch({
  value, onValueChange, accessibilityLabel,
}: { value: boolean; onValueChange: (value: boolean) => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [on] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    Animated.timing(on, {
      toValue: value ? 1 : 0, duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.quad), useNativeDriver: false,
    }).start();
  }, [on, value, reduceMotion]);
  if (Platform.OS !== 'web') {
    return (
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={accessibilityLabel}
        trackColor={{ true: theme.accent, false: theme.raised }}
        thumbColor={Platform.OS === 'ios' ? undefined : '#FFFFFF'}
      />
    );
  }
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View
        style={[
          styles.switchTrack,
          { backgroundColor: on.interpolate({ inputRange: [0, 1], outputRange: [theme.raised, theme.accent] }) },
        ]}
      >
        <Animated.View
          style={[
            styles.switchThumb,
            { transform: [{ translateX: on.interpolate({ inputRange: [0, 1], outputRange: [0, SWITCH.width - SWITCH.thumb - 2 * SWITCH_INSET] }) }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

// MARK: - Buttons

/**
 * The one action a screen is for: sign in, continue, report it. Full width, filled. The
 * fill is a parameter so reporting a class cancelled is filled with the cancellation orange.
 */
/**
 * The radius a big button takes where it sits. Normally `Radius.control`; along the foot of a
 * popup on a rounded-screen phone, the buttons are in the screen's own corners, and
 * `BottomCard` hands them the radius concentric with those.
 */
const ButtonCorner = createContext<number>(Radius.control);

/**
 * A tray's top corners. On a rounded-screen phone, the screen's own radius, as the system's
 * sheets have it; on a square screen, a dialog's, drawn round the controls inside.
 */
function trayRadius(bottomInset: number): number {
  return screenCorner(bottomInset) || Radius.dialog;
}

/** What sits `Space.xl` inside a tray — its buttons and lists — curving round the tray's corners. */
function trayInner(bottomInset: number): number {
  return concentric(trayRadius(bottomInset), Space.xl);
}

export function PrimaryButton({
  title, onPress, disabled, busy, fill, foreground,
}: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; fill?: string; foreground?: string }) {
  const theme = useTheme();
  const corner = useContext(ButtonCorner);
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
        { borderRadius: corner, backgroundColor: fill ?? theme.accent, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Txt type="headline" color={fg} style={styles.centerText}>{withShinyPlus(title, 'onFill')}</Txt>
    </Pressable>
  );
}

/** The alternative to a primary action — "Not now". Same shape, quieter fill. */
export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  const corner = useContext(ButtonCorner);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.bigButton, { borderRadius: corner, backgroundColor: theme.raised, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
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

/**
 * A plain text button for a header bar: "Done", "Cancel". `dimmed` looks like `disabled` but
 * still takes the press, so a form can say then what's missing rather than nagging beforehand.
 */
export function BarButton({
  title, onPress, disabled, dimmed, bold,
}: { title: string; onPress: () => void; disabled?: boolean; dimmed?: boolean; bold?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || dimmed) }}
      hitSlop={10}
      style={styles.barButton}
    >
      <Txt color={theme.accent} style={[bold && styles.semibold, (disabled || dimmed) && styles.disabled]}>{title}</Txt>
    </Pressable>
  );
}

/**
 * A small capsule for a header: "Edit" on a tinted pill, or filled violet while it's the thing
 * to press next ("Done"). An icon-only one is a circle, as the + for a new deadline is.
 */
export function PillButton({
  title, icon, onPress, filled, disabled, label,
}: { title?: string; icon?: IconName; onPress: () => void; filled?: boolean; disabled?: boolean; label?: string }) {
  const theme = useTheme();
  const ink = filled ? theme.onAccent : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pillButton,
        !title && styles.pillRound,
        { backgroundColor: filled ? theme.accent : withAlpha(theme.accent, theme.scheme === 'dark' ? 0.2 : 0.1), opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={title ? 15 : 20} color={ink} /> : null}
      {title ? <Txt type="subheadline" color={ink} style={styles.semibold}>{title}</Txt> : null}
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
 * A segmented control, for a few mutually exclusive choices — drawn as the tab bar and the
 * Pending / Completed pills are: a violet pill behind the chosen segment, sliding to the next.
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

  return (
    <View
      style={[styles.segmented, { backgroundColor: theme.raised }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentPill, { width: segmentWidth, backgroundColor: theme.accent, transform: [{ translateX: offset }] }]}
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
            <Txt type="subheadline" color={selected ? theme.onAccent : theme.inkSecondary} style={selected ? styles.semibold : undefined}>
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
            {
              backgroundColor: theme.surface, paddingBottom: Space.xl + (wide ? 0 : insets.bottom),
              borderTopLeftRadius: trayRadius(insets.bottom), borderTopRightRadius: trayRadius(insets.bottom),
            },
            wide && styles.dialog,
          ]}
        >
          {wide ? <View style={styles.dialogTop} /> : <View style={[styles.grabber, { backgroundColor: theme.rail }]} />}
          {/* A dialog's corners are drawn round its buttons'; a tray's buttons round the screen's. */}
          <ButtonCorner.Provider value={wide ? Radius.control : trayInner(insets.bottom)}>
            <ScrollView bounces={false} contentContainerStyle={styles.bottomCardContent}>{children}</ScrollView>
          </ButtonCorner.Provider>
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
  /** The choice in force, ticked — for a menu that picks one of several. */
  selected?: boolean;
  onPress: () => void;
}

/** A short list of choices with an optional question above them — a menu or a dialog. */
export function ActionSheet({
  visible, title, message, actions, onClose,
}: { visible: boolean; title?: string; message?: string; actions: SheetAction[]; onClose: () => void }) {
  const theme = useTheme();
  // The list sits in the card's top corners, the same inset as the buttons below, so it takes
  // their radius and curves round the same corner centres.
  const wide = useWide();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.card, { backgroundColor: theme.raised, borderRadius: wide ? Radius.control : trayInner(insets.bottom) }]}>
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
  // A card's worth of air between groups, so each heading reads as starting the next one.
  section: { marginHorizontal: Space.l, marginTop: Space.xl },
  // In line with the text in the card below: `CardInset.x` from its edge.
  sectionHeader: { marginBottom: Space.xs + 2, marginHorizontal: CardInset.x, fontWeight: '600' },
  sectionFooter: { marginTop: Space.xs + 2, marginHorizontal: CardInset.x },
  card: { borderRadius: Radius.card, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: CardInset.x },
  row: { minHeight: MIN_TARGET, paddingHorizontal: CardInset.x, paddingVertical: CardInset.y, justifyContent: 'center' },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  switchTrack: { width: SWITCH.width, height: SWITCH.height, borderRadius: SWITCH.height / 2, padding: SWITCH_INSET },
  switchThumb: {
    width: SWITCH.thumb, height: SWITCH.thumb, borderRadius: SWITCH.thumb / 2, backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
  },
  labeled: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.m, flexWrap: 'wrap' },
  labeledValue: { flexShrink: 1, textAlign: 'right' },
  disabled: { opacity: 0.4 },
  bigButton: {
    minHeight: MIN_TARGET, paddingHorizontal: Space.l, paddingVertical: Space.m,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.s, alignSelf: 'stretch',
  },
  centerText: { textAlign: 'center' },
  inlineTarget: { minHeight: MIN_TARGET, justifyContent: 'center' },
  inlineChip: { borderRadius: Radius.control, paddingHorizontal: Space.m, paddingVertical: Space.xs + Space.xxs },
  medium: { fontWeight: '500' },
  deadlineMark: { alignItems: 'center', justifyContent: 'center' },
  deadlineMarkText: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
  pillButton: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 34, paddingHorizontal: Space.m, borderRadius: 999, marginHorizontal: Space.xs },
  pillRound: { width: 36, height: 36, paddingHorizontal: 0, justifyContent: 'center' },
  actionLead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.m },
  actionTrail: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  iconTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  screenHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.s, paddingBottom: Space.s, minHeight: 52 },
  screenHeaderSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  screenHeaderRight: { justifyContent: 'flex-end' },
  screenHeaderTitle: { flexShrink: 1, maxWidth: '64%', alignItems: 'center' },
  barButton: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: Space.xs },
  iconButton: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segment: { flex: 1, minHeight: MIN_TARGET - 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.s },
  segmentPill: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 999 },
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
  bottomCard: { paddingHorizontal: Space.xl, maxHeight: '85%' },
  centred: { justifyContent: 'center', alignItems: 'center', padding: Space.xl },
  // Concentric with the buttons and lists in its corners, `Space.xl` in from its edge.
  dialog: { width: '100%', maxWidth: Desktop.dialog, borderRadius: Radius.dialog },
  dialogTop: { height: Space.xl },
  panel: {
    width: '100%', maxWidth: Desktop.panel, height: '100%', maxHeight: 760, borderRadius: Radius.panel,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  bottomCardContent: { gap: Space.l },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: Space.s, marginBottom: Space.l },
  confirmBody: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  buttonStack: { gap: Space.s },
  actionHeader: { gap: Space.xs, alignItems: 'center' },
  actionRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: CardInset.x },
});
