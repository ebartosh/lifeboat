import React from 'react';
import { Text as NativeText, TextInput as NativeInput, StyleSheet, useWindowDimensions as nativeDimensions } from 'react-native-web';
export * from 'react-native-web';
const scale = Number(new URLSearchParams(location.search).get('scale') || 1);
export const useWindowDimensions = () => ({ ...nativeDimensions(), fontScale: scale });
const scaled = style => { const flat = StyleSheet.flatten(style) || {}; return [style, { fontSize: (flat.fontSize || 14) * scale, ...(flat.lineHeight ? { lineHeight: flat.lineHeight * scale } : {}) }]; };
export const Text = React.forwardRef((props, ref) => <NativeText {...props} ref={ref} style={scaled(props.style)} />);
export const TextInput = React.forwardRef((props, ref) => <NativeInput {...props} ref={ref} style={scaled(props.style)} />);
