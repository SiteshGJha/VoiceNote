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
export const ActivityIndicator = 'ActivityIndicator';
export const TouchableOpacity = 'TouchableOpacity';
export const SafeAreaView = 'SafeAreaView';
export const FlatList = (props: any) => {
  const { data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, ...rest } = props || {};
  let items: any[] = [];
  if (Array.isArray(data) && data.length > 0) {
    items = data.map((item: any, index: number) => (renderItem ? renderItem({ item, index }) : null));
  } else if (ListEmptyComponent) {
    const empty = typeof ListEmptyComponent === 'function' ? ListEmptyComponent() : ListEmptyComponent;
    if (empty) items = [empty];
  }
  const header = typeof ListHeaderComponent === 'function' ? ListHeaderComponent() : ListHeaderComponent;
  const footer = typeof ListFooterComponent === 'function' ? ListFooterComponent() : ListFooterComponent;
  return {
    type: 'FlatList',
    props: {
      ...rest,
      children: [header, ...items, footer].filter(Boolean),
    },
  };
};
export const Modal = 'Modal';
export const Share = {
  share: () => Promise.resolve({ action: 'sharedAction' }),
};

export default {
  Platform,
  NativeModules,
  NativeEventEmitter,
  InteractionManager,
  Alert,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Modal,
  Share,
};

