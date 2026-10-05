import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps, type TextProps } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ActionButton, DialogCommandContext, lastCommand } from './ActionButton';
import { colors, mono, ui } from './theme';

export function Body({ style, ...props }: TextProps) { return <Text {...props} style={[ui.body, style]} />; }
export function Heading({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>;
}
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.outer}><View style={styles.inner}>
    <Heading>{title}</Heading>{children}
  </View></View>;
}
export function PanePair({ list, details }: { list: ReactNode; details: ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const wide = width / fontScale >= 720;
  return <View style={[ui.stack, wide && styles.pair]}>
    <View style={wide && styles.pane}>{list}</View><View style={wide && styles.pane}>{details}</View>
  </View>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <View style={styles.notice}><Body accessibilityLiveRegion="polite">
    {error ? 'Error: ' : ''}{children}
  </Body></View>;
}
export function DataRow({ title, kind, value, selected, onPress }: {
  title: string; kind: string; value?: string; selected: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={`${title}. ${kind}${value ? `. ${value}` : ''}`}
    accessibilityHint="Select an entry and show details" onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed, focused && styles.focus]}>
    <Body>{selected ? '> ' : '  '}{title}</Body>
    <Text style={ui.label}>{kind}</Text>
    {!!value && <Body style={styles.value}>{value}</Body>}
  </Pressable>;
}
export function AddressField({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => { setMessage(''); }, [value]);
  return <View style={ui.stack}><Body>{label}</Body>
    <Body selectable accessibilityLabel={`${label}: ${value}`} style={styles.address}>{value}</Body>
    <ActionButton title={`Copy: ${label}`} onPress={() => {
      void Clipboard.setStringAsync(value).then(() => setMessage(label === 'Signature' ? 'Signature copied' : 'Address copied'))
        .catch(() => setMessage('Error: could not copy'));
    }} />
    {!!message && <Body accessibilityLiveRegion="polite">{message}</Body>}
  </View>;
}
export function AmountInput({ label, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return <View style={ui.stack}><Body>{label}</Body><TextInput {...props} accessibilityLabel={label}
    autoCorrect={false} autoCapitalize="none" placeholderTextColor={colors.navy}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[ui.body, styles.input, focused && styles.focus, props.editable === false && { backgroundColor: colors.surface }]} />
    {!!props.value && <Body selectable>{props.value}</Body>}
  </View>;
}
let openDialogs = 0;
export function Dialog({ visible, title, onClose, children, closeLabel = 'Back' }: {
  visible: boolean; title: string; onClose?: () => void; children: ReactNode; closeLabel?: string;
}) {
  const heading = useRef<Text>(null);
  const origin = useRef<View | null>(null);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) return;
    openDialogs++;
    return () => { openDialogs--; };
  }, [visible]);
  useEffect(() => {
    if (visible && !wasVisible.current) origin.current = lastCommand;
    if (!visible && wasVisible.current) {
      const target = origin.current;
      const timer = setTimeout(() => {
        if (openDialogs > 0) return;
        target?.focus();
        if (Platform.OS !== 'web' && target) {
          const handle = findNodeHandle(target);
          if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
        }
      }, 150);
      wasVisible.current = visible;
      return () => clearTimeout(timer);
    }
    wasVisible.current = visible;
  }, [visible]);
  return <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent
    onRequestClose={() => onClose?.()} onShow={() => {
      const handle = Platform.OS !== 'web' ? findNodeHandle(heading.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }}>
    <SafeAreaProvider><SafeAreaView style={styles.overlay}>
      <KeyboardAvoidingView style={styles.dialogSpace} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View accessibilityViewIsModal style={styles.dialogOuter}><View style={styles.dialogInner}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
            <Text ref={heading} accessible accessibilityRole="header" style={ui.heading}>{title}</Text>
            <DialogCommandContext.Provider value={true}>
              {children}
              {onClose && <ActionButton title={closeLabel} onPress={onClose} />}
            </DialogCommandContext.Provider>
          </ScrollView>
        </View></View>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  outer: { padding: 2, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.white, minWidth: 0 },
  inner: { padding: 8, gap: 12, borderWidth: 1, borderColor: colors.blue, minWidth: 0 },
  pair: { flexDirection: 'row', alignItems: 'flex-start' }, pane: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  notice: { backgroundColor: colors.lightBlue, padding: 8 },
  row: { minWidth: 48, minHeight: 48, padding: 8, gap: 4, borderBottomWidth: 1, borderColor: colors.line },
  selected: { backgroundColor: colors.softOrange }, pressed: { borderBottomColor: colors.navy, borderBottomWidth: 2 },
  value: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  address: { fontFamily: mono, fontVariant: ['no-common-ligatures', 'no-contextual'] },
  focus: { outlineWidth: 2, outlineColor: colors.blue, outlineOffset: 2 },
  input: { minHeight: 48, minWidth: 48, borderWidth: 1, borderColor: colors.navy, padding: 12, borderRadius: 2 },
  overlay: { flex: 1, backgroundColor: '#163B7333' },
  dialogSpace: { flex: 1, padding: 8, alignItems: 'center', justifyContent: 'center' },
  dialogOuter: { width: '100%', maxWidth: 680, flexShrink: 1, borderWidth: 2, borderColor: colors.navy,
    padding: 2, backgroundColor: colors.white },
  dialogInner: { borderWidth: 1, borderColor: colors.blue, flexShrink: 1 },
  dialogContent: { padding: 12, gap: 16 },
});
