import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, medium } from './theme';

// Remember the invoking command's ref, not its instance: React clears the ref when the command unmounts, so a
// closing dialog never restores focus to a view that no longer exists.
export let lastCommand: RefObject<View | null> | null = null;
export const DialogCommandContext = createContext(false);
type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
/** Far-style command label: the underlined first letter marks an interactive element. */
export function HotkeyLabel({ title, style, filled = false, disabled = false }: {
  title: string; style?: StyleProp<TextStyle>; filled?: boolean; disabled?: boolean;
}) {
  if (disabled || !title) return <Text style={style}>{title}</Text>;
  return <Text style={style}><Text style={[styles.hotkey, !filled && { color: colors.hotkey }]}>{title[0]}</Text>{title.slice(1)}</Text>;
}
/**
 * Far-style bracketed command: `[ Title ]`. The label sits on a band inside a 48 dp touch target; the band is orange
 * for the primary action and marks pressed and disabled states. Borderless commands pull their touch padding into the
 * margin so the label aligns with surrounding text (`align` picks the side). Brackets are visual only.
 */
export function ActionButton({ title, onPress, disabled = false, variant = 'secondary', style, icon, hotkey = true,
  textStyle, accessibilityLabel, align = 'start' }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: Variant; style?: ViewStyle; icon?: ReactNode;
  hotkey?: boolean; textStyle?: TextStyle; accessibilityLabel?: string; align?: 'start' | 'end';
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const inDialog = useContext(DialogCommandContext);
  const primary = variant === 'primary';
  return <Pressable ref={ref} accessibilityRole="button" accessibilityState={{ disabled }}
    accessibilityLabel={accessibilityLabel ?? title}
    disabled={disabled} onPress={() => { if (!inDialog) lastCommand = ref; onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.button, primary ? styles.primary : align === 'end' ? styles.end : styles.start, style,
      focused && styles.focus]}>
    {({ pressed }) => {
      const active = pressed && !disabled;
      // Bright blue stays on white; a pressed band switches the label to navy.
      const color = disabled ? colors.secondary : primary ? colors.ink : variant === 'danger' ? colors.danger
        : active ? colors.navy : colors.blue;
      const label = [styles.label, { color }];
      const labelStyle = disabled ? undefined : textStyle;
      return <View style={[styles.band, primary && styles.primaryBand,
        active && (primary ? styles.primaryPressed : styles.pressedBand), disabled && styles.disabledBand]}>
        {icon ? <View style={styles.iconRow}><Text style={label}>[</Text><View style={styles.icon}>{icon}</View>
          <Text style={label}>]</Text></View>
          : <Text style={label}>{'[ '}{hotkey && !disabled
            ? <HotkeyLabel title={title} style={labelStyle} filled={primary || variant === 'danger'} />
            : <Text style={labelStyle}>{title}</Text>}{' ]'}</Text>}
      </View>;
    }}
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 48, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center',
    paddingVertical: 10 },
  start: { paddingHorizontal: 8, marginLeft: -8, alignItems: 'flex-start' },
  end: { paddingHorizontal: 8, marginRight: -8, alignItems: 'flex-end' },
  primary: { alignItems: 'flex-start' },
  band: { minHeight: 28, maxWidth: '100%', flexShrink: 1, justifyContent: 'center', paddingVertical: 4 },
  primaryBand: { backgroundColor: colors.orange },
  primaryPressed: { backgroundColor: colors.pressedOrange },
  pressedBand: { backgroundColor: colors.lightBlue },
  disabledBand: { backgroundColor: colors.disabledFill },
  label: { fontFamily: medium, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  iconRow: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginHorizontal: 8 },
  hotkey: { textDecorationLine: 'underline' },
  focus: { outlineColor: colors.blue, outlineWidth: 2, outlineOffset: 2 },
});
