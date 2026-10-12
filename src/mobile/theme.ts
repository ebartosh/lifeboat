import { StyleSheet } from 'react-native';

export const colors = {
  navy: '#163B73', blue: '#2F6FE4', lightBlue: '#EAF3FF', orange: '#FF7A1A',
  softOrange: '#FFD2B0', white: '#FFFFFF', surface: '#F7FAFD', ink: '#20334D',
  line: '#DCE6F2', danger: '#A63838',
  // Command bands: pressed primary action and disabled commands.
  pressedOrange: '#FFA05A', disabledFill: '#E3E8EE',
  // Highlight groups: each color has exactly one meaning, as in Far Manager.
  secondary: '#4A6287', header: '#7A4A00', token: '#006670', address: '#1D5A9E',
  ok: '#1E6B34', hotkey: '#C2410C',
} as const;
export const mono = 'IBMPlexMono-Regular';
export const medium = 'IBMPlexMono-Medium';
export const semibold = 'IBMPlexMono-SemiBold';
export const serif = 'IBMPlexSerif-Medium';
export const ui = StyleSheet.create({
  body: { fontFamily: mono, fontSize: 14, lineHeight: 20, color: colors.navy, flexShrink: 1 },
  heading: { fontFamily: serif, fontSize: 22, lineHeight: 30, color: colors.navy, flexShrink: 1 },
  label: { fontFamily: medium, fontSize: 12, lineHeight: 18, color: colors.navy },
  note: { fontFamily: mono, fontSize: 13, lineHeight: 18, color: colors.secondary, flexShrink: 1 },
  stack: { gap: 12, minWidth: 0 },
  // Details on the left; `actions` holds the financial commands on the right.
  commands: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: 16,
    marginLeft: 'auto' },
  separator: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 8 },
});
