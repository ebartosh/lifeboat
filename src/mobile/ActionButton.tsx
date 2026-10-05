import { createContext, useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type View, type ViewStyle } from 'react-native';
import { colors, medium } from './theme';

// Remember the invoking command, including its native accessibility target.
export let lastCommand: View | null = null;
export const DialogCommandContext = createContext(false);
type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
export function ActionButton({ title, onPress, disabled = false, variant = 'secondary', style, selected }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: Variant; style?: ViewStyle; selected?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const inDialog = useContext(DialogCommandContext);
  return <Pressable ref={ref} accessibilityRole={selected === undefined ? 'button' : 'tab'} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={() => { if (!inDialog) lastCommand = ref.current; onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, variant === 'primary' && styles.primary, style,
      disabled && styles.disabled, pressed && !disabled && styles.pressed, focused && styles.focus]}>
    <Text style={[styles.label, variant === 'primary' && { color: colors.ink },
      variant === 'danger' && { color: colors.danger }, disabled && { color: colors.navy }]}>{selected ? '> ' : ''}{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 48, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.blue, borderRadius: 2,
    backgroundColor: colors.white },
  label: { fontFamily: medium, fontSize: 14, lineHeight: 20, color: colors.blue, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: colors.orange, borderColor: colors.navy },
  pressed: { borderColor: colors.navy, backgroundColor: colors.lightBlue, transform: [{ translateY: 1 }] },
  disabled: { backgroundColor: colors.surface, borderColor: colors.navy, borderStyle: 'dashed' },
  focus: { outlineColor: colors.blue, outlineWidth: 2, outlineOffset: 2 },
});
