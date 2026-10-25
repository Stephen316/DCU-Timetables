import { RefObject, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Icon, Label, SheetAction, Txt } from './components';
import { CardInset, Radius, Space, useTheme } from './theme';

/**
 * A menu that drops down from the button that opened it, its right edge under the button's,
 * as iOS's pull-down menus do — rather than a tray rising from the far end of the screen. A
 * tap outside closes it; so does choosing.
 */
export function DropdownMenu({ visible, anchor, actions, onClose, align = 'right' }: {
  visible: boolean;
  /** The button it hangs from. */
  anchor: RefObject<View | null>;
  /** Under the button's right edge, or centred under a button in the middle of a bar. */
  align?: 'right' | 'center';
  actions: SheetAction[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const width = Math.min(MENU_WIDTH, window.width - Space.s * 2);

  // Measured as it opens, so a rotation or a resized window since is no trouble.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) setPlace(null);
  }
  const measure = () =>
    anchor.current?.measureInWindow((x, y, anchorWidth, height) => {
      const left = align === 'center' ? x + (anchorWidth - width) / 2 : x + anchorWidth - width;
      // Kept on screen, whichever way it would otherwise run off.
      setPlace({ top: y + height + Space.xs, left: Math.min(Math.max(left, Space.s), window.width - width - Space.s) });
    });

  // iOS ignores a modal presented while another is still going away, and a choice here often
  // opens one (Account, Notifications). So on iOS the choice waits for the menu to close,
  // with a fallback in case that callback never comes.
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
    <Modal visible={visible} transparent animationType="fade" onShow={measure} onRequestClose={onClose} onDismiss={runPending}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      {/* Drawn once it's measured, so it never flashes up in the wrong place. */}
      <View
        onLayout={place ? undefined : measure}
        accessibilityViewIsModal
        style={[
          styles.menu,
          { width, backgroundColor: theme.raised, borderColor: theme.separator, opacity: place ? 1 : 0 },
          place ?? { top: 0, left: Space.s },
        ]}
      >
        {actions.map((action, i) => (
          <View key={action.label}>
            {i > 0 ? <View style={[styles.hairline, { backgroundColor: theme.separator }]} /> : null}
            <Pressable
              accessibilityRole="menuitem"
              accessibilityState={{ selected: !!action.selected }}
              onPress={() => choose(action)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface }]}
            >
              <View style={styles.choice}>
                {action.icon ? (
                  <Label icon={action.icon} text={action.label} color={action.destructive ? theme.destructive : theme.ink} />
                ) : (
                  <Txt numberOfLines={1} style={styles.flex} color={action.destructive ? theme.destructive : theme.ink}>{action.label}</Txt>
                )}
                {action.selected ? <Icon name="check" color={theme.accent} /> : null}
              </View>
            </Pressable>
          </View>
        ))}
      </View>
    </Modal>
  );
}

const MENU_WIDTH = 260;

const styles = StyleSheet.create({
  // A card: its rows `CardInset.x` in, its corners concentric with what's in them.
  menu: {
    position: 'absolute', borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  row: { minHeight: 48, justifyContent: 'center', paddingHorizontal: CardInset.x },
  choice: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  flex: { flex: 1 },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: CardInset.x },
});
