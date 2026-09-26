export const Platform = {
  OS: 'ios',
  select: (obj: Record<string, any>) => obj.ios ?? obj.default,
};

export const NativeModules: Record<string, any> = {
  VoiceNoteNativeAudio: undefined,
};

export class NativeEventEmitter {
  addListener() {
    return { remove: () => {} };
  }
}

export const InteractionManager = {
  runAfterInteractions: (cb: () => void) => cb(),
};

export const Alert = {
  alert: () => {},
};

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
  flatten: (style: any) => (Array.isArray(style) ? Object.assign({}, ...style) : style),
};

export const View = 'View';
export const Text = 'Text';

export default {
  Platform,
  NativeModules,
  NativeEventEmitter,
  InteractionManager,
  Alert,
  StyleSheet,
  View,
  Text,
};

