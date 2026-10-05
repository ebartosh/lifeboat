import { StyleSheet } from 'react-native';

export const colors = {
  navy: '#163B73', blue: '#2F6FE4', lightBlue: '#EAF3FF', orange: '#FF7A1A',
  softOrange: '#FFD2B0', white: '#FFFFFF', surface: '#F7FAFD', ink: '#20334D',
  line: '#DCE6F2', danger: '#A63838',
} as const;
export const mono = 'IBMPlexMono-Regular';
export const medium = 'IBMPlexMono-Medium';
export const serif = 'IBMPlexSerif-Medium';
export const ui = StyleSheet.create({
  body: { fontFamily: mono, fontSize: 14, lineHeight: 20, color: colors.navy, flexShrink: 1 },
  heading: { fontFamily: serif, fontSize: 22, lineHeight: 30, color: colors.navy, flexShrink: 1 },
  label: { fontFamily: medium, fontSize: 12, lineHeight: 18, color: colors.navy },
  stack: { gap: 12, minWidth: 0 },
  commands: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  separator: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 8 },
});
