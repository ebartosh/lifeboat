import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps, type TextProps,
  type StyleProp, type TextStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ActionButton, DialogCommandContext, HotkeyLabel, lastCommand } from './ActionButton';
import { groupDigits } from '../core/format';
import { colors, medium, mono, semibold, serif, ui } from './theme';

export function Body({ style, ...props }: TextProps) { return <Text {...props} style={[ui.body, style]} />; }
/** Secondary explanation text: smaller and muted so data stays prominent. */
export function Note({ style, ...props }: TextProps) { return <Text {...props} style={[ui.note, style]} />; }
export const readTime = (at: number) =>
  `Read ${new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
export function Heading({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>;
}
// Double border edge pieces. The title and footer interrupt the lines, as in Far Manager.
function TopEdge({ end }: { end?: 'start' | 'end' }) {
  return <View style={end ? styles.corner : styles.edgeFill}><View style={styles.edgeHalf} />
    <View style={[styles.edgeHalf, styles.outerTop, end === 'start' && styles.outerStart, end === 'end' && styles.outerEnd]}>
      <View style={[styles.edgeHalf, styles.innerTop, end === 'start' && styles.innerStart, end === 'end' && styles.innerEnd]} />
    </View>
  </View>;
}
function BottomEdge({ end, fill = !end }: { end?: 'start' | 'end'; fill?: boolean }) {
  return <View style={end ? styles.corner : fill ? styles.edgeFill : styles.edgeShort}>
    <View style={[styles.edgeHalf, styles.outerBottom, end === 'start' && styles.outerStart, end === 'end' && styles.outerEnd]}>
      <View style={[styles.edgeHalf, styles.innerBottom, end === 'start' && styles.innerStart, end === 'end' && styles.innerEnd]} />
    </View><View style={styles.edgeHalf} />
  </View>;
}
export function Panel({ title, titleColor, footer, children }: {
  title: string; titleColor?: string; footer?: string; children: ReactNode;
}) {
  return <View style={styles.panel}>
    <View style={styles.edgeRow}>
      <TopEdge end="start" />
      <Text accessibilityRole="header" style={[styles.panelTitle, titleColor ? { color: titleColor } : null]}>{title}</Text>
      <TopEdge /><TopEdge end="end" />
    </View>
    <View style={[styles.outer, !footer && styles.outerClosed]}>
      <View style={[styles.inner, !footer && styles.innerClosed]}>{children}</View>
    </View>
    {!!footer && <View style={styles.edgeRow}>
      <BottomEdge end="start" /><BottomEdge />
      <Text style={styles.panelFooter}>{footer}</Text>
      <BottomEdge fill={false} /><BottomEdge end="end" />
    </View>}
  </View>;
}
export function PanePair({ list, details }: { list: ReactNode; details: ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const wide = width / fontScale >= 720;
  return <View style={[styles.panes, wide && styles.pair]}>
    <View style={wide && styles.pane}>{list}</View><View style={wide && styles.pane}>{details}</View>
  </View>;
}
export function Notice({ children, error = false, success = false }: { children: ReactNode; error?: boolean; success?: boolean }) {
  return <View style={styles.notice}><Body accessibilityLiveRegion="polite">
    {error ? <Text style={[styles.strong, { color: colors.danger }]}>Error: </Text>
      : success ? <Text style={[styles.strong, { color: colors.ok }]}>✓ </Text> : null}{children}
  </Body></View>;
}
/** Column titles above a list; the leading spaces match the row selection marker. */
export function ListHeader({ left, right }: { left: string; right: string }) {
  return <View style={styles.listHeader}>
    <Text style={ui.body} accessible={false}>{'  '}</Text>
    <Text style={[styles.columnTitle, styles.grow]}>{left}</Text><Text style={styles.columnTitle}>{right}</Text>
  </View>;
}
const amountPattern = /^(≈?)(-?\d+)(\.\d+)? ([A-Za-z][\w.-]*)$/;
/** A number with its token: digits grouped, the token highlighted. Other text renders unchanged. */
export function Amount({ value, hero = false, style }: { value: string; hero?: boolean; style?: StyleProp<TextStyle> }) {
  const match = value.match(amountPattern);
  // Placeholders such as "Amount unknown" must not look like a large number.
  if (!match) return <Text selectable style={[ui.body, style]}>{value}</Text>;
  const base = [hero ? styles.hero : ui.body, styles.tabular, style];
  const [, approx, whole, fraction = '', token] = match;
  return <Text selectable style={base}>{approx}{groupDigits(whole!)}{fraction}{' '}
    <Text style={[hero && styles.heroToken, { color: colors.token }]}>{token}</Text></Text>;
}
/** One label with one or more right-aligned values; values move below the label when space runs out. */
export function Field({ label, values }: { label: string; values: (string | ReactNode)[] }) {
  return <View style={styles.field}>
    <Text style={[ui.body, { color: colors.secondary }]}>{label}</Text>
    <View style={styles.fieldValues}>{values.map((value, index) => typeof value === 'string'
      ? <Amount key={index} value={value} style={styles.right} /> : <View key={index}>{value}</View>)}</View>
  </View>;
}
export function Section({ title, children, divider = true }: { title: string; children: ReactNode; divider?: boolean }) {
  return <View style={[styles.section, divider && styles.divider]}>
    <Text accessibilityRole="header" style={[ui.label, { color: colors.header }]}>{title}</Text>{children}
  </View>;
}
export function Tabs<T extends string>({ items, selected, onSelect }: {
  items: { id: T; title: string }[]; selected: T; onSelect: (id: T) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  // Stack the tabs once the longest monospaced label no longer fits its share of the screen-wide bar.
  const longest = Math.max(...items.map(item => item.title.length));
  const stacked = (width - 26) / items.length < longest * 8.4 * fontScale + 12;
  return <View accessibilityRole="tablist" style={[styles.tabs, stacked && styles.tabsStacked]}>
    {items.map((item, index) => <Tab key={item.id} title={item.title} first={index === 0} stacked={stacked}
      selected={item.id === selected} onPress={() => onSelect(item.id)} />)}
  </View>;
}
function Tab({ title, selected, first, stacked, onPress }: {
  title: string; selected: boolean; first: boolean; stacked: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={title} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.tab, stacked ? [styles.tabStacked, !first && styles.tabDividerStacked]
      : !first && styles.tabDivider, selected && (stacked ? styles.tabSelectedStacked : styles.tabSelected),
      pressed && styles.tabPressed, focused && styles.focus]}>
    <HotkeyLabel title={title} style={[styles.tabLabel, selected && { color: colors.navy }]} />
  </Pressable>;
}
export function DataRow({ title, titleColor, kind, address, value, valueColor, selected, onPress }: {
  title: string; titleColor?: string; kind: string; address?: string; value?: string; valueColor?: string;
  selected: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const detail = address ? `${kind} · ${address}` : kind;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={`${title}. ${detail}${value ? `. ${value}` : ''}`}
    accessibilityHint="Select an entry and show details" onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed, focused && styles.focus]}>
    <Text style={ui.body}>{selected ? '> ' : '  '}</Text>
    <View style={styles.rowText}>
      <View style={styles.rowLine}>
        <Body style={[styles.grow, titleColor ? { color: titleColor } : null]}>{title}</Body>
        {!!value && <Amount value={value} style={[styles.rowValue, valueColor ? { color: valueColor } : null]} />}
      </View>
      <Text style={[ui.label, { color: selected ? colors.navy : colors.secondary }]}>
        {kind}{!!address && <Text style={{ color: colors.address }}>{` · ${address}`}</Text>}
      </Text>
    </View>
  </Pressable>;
}
export function AddressField({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => { setMessage(''); }, [value]);
  return <View>
    <View style={styles.addressHead}>
      <Text style={[ui.body, styles.strong, styles.grow]}>{label}</Text>
      <ActionButton title={message ? 'Copied' : 'Copy'} variant="quiet" align="end" accessibilityLabel={`Copy: ${label}`} onPress={() => {
        void Clipboard.setStringAsync(value).then(() => setMessage(label === 'Signature' ? 'Signature copied' : 'Address copied'))
          .catch(() => setMessage('Error: could not copy'));
      }} />
    </View>
    <Body selectable accessibilityLabel={`${label}: ${value}`} style={styles.address}>{value}</Body>
    {!!message && <Note accessibilityLiveRegion="polite">{message}</Note>}
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
/** Header and commands stay fixed; only the content between them scrolls. */
export function Dialog({ visible, title, subtitle, onClose, children, closeLabel = 'Back', actions }: {
  visible: boolean; title: string; subtitle?: string; onClose?: () => void; children: ReactNode; closeLabel?: string;
  actions?: ReactNode;
}) {
  const heading = useRef<Text>(null);
  const origin = useRef<RefObject<View | null> | null>(null);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) return;
    openDialogs++;
    return () => { openDialogs--; };
  }, [visible]);
  useEffect(() => {
    if (visible && !wasVisible.current) origin.current = lastCommand;
    if (!visible && wasVisible.current) {
      const timer = setTimeout(() => {
        if (openDialogs > 0) return;
        // Read the ref only now: it is null if the command unmounted while the dialog was open.
        const target = origin.current?.current;
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
          <DialogCommandContext.Provider value={true}>
            <View style={styles.dialogHeader}>
              <Text ref={heading} accessible accessibilityRole="header" style={ui.heading}>{title}</Text>
              {!!subtitle && <Note>{subtitle}</Note>}
            </View>
            <ScrollView style={styles.dialogScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
              {children}
            </ScrollView>
            {(onClose || actions) && <View style={styles.dialogFooter}>
              {onClose && <ActionButton title={closeLabel} variant="quiet" onPress={onClose} />}
              {!!actions && <View style={styles.dialogActions}>{actions}</View>}
            </View>}
          </DialogCommandContext.Provider>
        </View></View>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  panel: { minWidth: 0 },
  edgeRow: { flexDirection: 'row', alignItems: 'stretch', minWidth: 0 },
  corner: { width: 10 }, edgeFill: { flexGrow: 1, flexBasis: 8 }, edgeShort: { width: 8 },
  edgeHalf: { flexGrow: 1, flexBasis: 0 },
  outerTop: { borderTopWidth: 1, borderColor: colors.navy, paddingTop: 2 },
  innerTop: { borderTopWidth: 1, borderColor: colors.blue },
  outerBottom: { borderBottomWidth: 1, borderColor: colors.navy, paddingBottom: 2 },
  innerBottom: { borderBottomWidth: 1, borderColor: colors.blue },
  outerStart: { borderLeftWidth: 1, paddingLeft: 2 }, innerStart: { borderLeftWidth: 1 },
  outerEnd: { borderRightWidth: 1, paddingRight: 2 }, innerEnd: { borderRightWidth: 1 },
  panelTitle: { fontFamily: medium, fontSize: 13, lineHeight: 18, color: colors.navy, paddingHorizontal: 6, flexShrink: 1, minWidth: 0 },
  panelFooter: { ...ui.note, fontSize: 12, paddingHorizontal: 6 },
  outer: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.navy, paddingHorizontal: 2, minWidth: 0 },
  outerClosed: { borderBottomWidth: 1, paddingBottom: 2 },
  inner: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.blue, paddingHorizontal: 8, paddingTop: 6,
    paddingBottom: 8, gap: 12, minWidth: 0 },
  innerClosed: { borderBottomWidth: 1 },
  panes: { gap: 16, minWidth: 0 },
  pair: { flexDirection: 'row', alignItems: 'flex-start' }, pane: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  notice: { backgroundColor: colors.lightBlue, paddingVertical: 8, paddingHorizontal: 10 },
  strong: { fontFamily: medium },
  grow: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  listHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4,
    borderBottomWidth: 1, borderColor: colors.line },
  columnTitle: { fontFamily: medium, fontSize: 12, lineHeight: 18, color: colors.header },
  hero: { fontFamily: serif, fontSize: 22, lineHeight: 30, color: colors.navy, flexShrink: 1 },
  heroToken: { fontFamily: mono, fontSize: 14 },
  tabular: { fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right', maxWidth: '100%' },
  field: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
  fieldValues: { flexGrow: 1, flexShrink: 1, alignItems: 'flex-end' },
  section: { gap: 6, minWidth: 0 }, divider: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.blue, borderRadius: 2, overflow: 'hidden' },
  tab: { flexGrow: 1, flexBasis: 0, minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 4, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabDivider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  tabSelected: { backgroundColor: colors.lightBlue, borderBottomColor: colors.navy },
  tabsStacked: { flexDirection: 'column' },
  tabStacked: { flexBasis: 'auto', alignItems: 'flex-start', paddingHorizontal: 12, borderBottomWidth: 0,
    borderLeftWidth: 3, borderLeftColor: 'transparent' },
  tabDividerStacked: { borderTopWidth: 1, borderTopColor: colors.line },
  tabSelectedStacked: { backgroundColor: colors.lightBlue, borderLeftColor: colors.navy },
  tabPressed: { backgroundColor: colors.lightBlue },
  tabLabel: { fontFamily: semibold, fontSize: 14, lineHeight: 20, color: colors.blue, textAlign: 'center' },
  row: { flexDirection: 'row', minWidth: 48, minHeight: 48, padding: 8, borderBottomWidth: 1, borderColor: colors.line },
  rowText: { flexGrow: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  rowLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  rowValue: { marginLeft: 'auto', textAlign: 'right', minWidth: 0 },
  selected: { backgroundColor: colors.softOrange }, pressed: { borderBottomColor: colors.navy, borderBottomWidth: 2 },
  addressHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: -8 },
  address: { fontFamily: mono, color: colors.address, fontVariant: ['no-common-ligatures', 'no-contextual'] },
  focus: { outlineWidth: 2, outlineColor: colors.blue, outlineOffset: 2 },
  input: { minHeight: 48, minWidth: 48, borderWidth: 1, borderColor: colors.navy, padding: 12, borderRadius: 2 },
  overlay: { flex: 1, backgroundColor: '#163B7333' },
  dialogSpace: { flex: 1, padding: 8, alignItems: 'center', justifyContent: 'center' },
  dialogOuter: { width: '100%', maxWidth: 680, flexShrink: 1, borderWidth: 2, borderColor: colors.navy,
    padding: 2, backgroundColor: colors.white },
  dialogInner: { borderWidth: 1, borderColor: colors.blue, flexShrink: 1 },
  dialogHeader: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 2, borderBottomWidth: 1, borderColor: colors.line },
  dialogScroll: { flexGrow: 0, flexShrink: 1 },
  dialogContent: { padding: 12, gap: 16 },
  dialogFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderColor: colors.line },
  dialogActions: { flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end',
    alignItems: 'center', columnGap: 16 },
});
