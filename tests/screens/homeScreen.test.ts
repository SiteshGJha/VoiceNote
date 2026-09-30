import React from 'react';

// Mocks for React Native and dependencies
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

const mockStart = jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));
const mockStop = jest.fn().mockResolvedValue({
  uri: '/mock/path.wav',
  durationMs: 1000,
  sampleRate: 16000,
  channels: 1,
  byteLength: 32000,
  hasSpeech: true,
});
const mockCancel = jest.fn().mockResolvedValue(undefined);
let mockRecordingState = 'idle';

jest.mock('@/audio/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    recordingState: mockRecordingState,
    durationMs: 0,
    amplitude: 0,
    start: mockStart,
    stop: mockStop,
    cancel: mockCancel,
  }),
}));

jest.mock('@/services/modelManager', () => ({
  modelInstaller: {
    listInstalled: () => [
      { kind: 'asr', id: 'whisper-base' },
      { kind: 'slm', id: 'qwen' },
    ],
  },
}));

const mockNativeAudio = {
  isNativeAvailable: false,
};
jest.mock('@/native/nativeAudio', () => ({
  nativeAudio: mockNativeAudio,
}));

jest.mock('react-native', () => {
  return {
    Platform: {
      OS: 'ios',
      select: (obj: any) => obj.ios ?? obj.default,
    },
    NativeModules: {
      VoiceNoteNativeAudio: undefined,
    },
    NativeEventEmitter: class {
      addListener() {
        return { remove: () => {} };
      }
    },
    InteractionManager: {
      runAfterInteractions: (cb: () => void) => cb(),
    },
    Alert: {
      alert: jest.fn(),
    },
    StyleSheet: {
      create: (s: any) => s,
    },
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    SafeAreaView: 'SafeAreaView',
    ActivityIndicator: 'ActivityIndicator',
    PermissionsAndroid: {
      PERMISSIONS: {
        RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
      },
      RESULTS: {
        GRANTED: 'granted',
        DENIED: 'denied',
      },
      check: jest.fn().mockResolvedValue(true),
      request: jest.fn().mockResolvedValue('granted'),
    },
    Appearance: {
      getColorScheme: jest.fn().mockReturnValue('light'),
      addChangeListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    },
  };
});

// Mock child components
jest.mock('@/components/PermissionGate', () => ({
  PermissionGate: function PermissionGate(props: any) {
    return React.createElement('PermissionGate', props);
  },
}));
jest.mock('@/components/BrandIcon', () => ({
  BrandIcon: () => null,
}));
jest.mock('@/components/Waveform', () => ({
  Waveform: () => null,
}));
jest.mock('@/components/ToneSelector', () => ({
  ToneSelector: () => null,
}));
jest.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}));
jest.mock('@/components/AnimatedRecordButton', () => ({
  AnimatedRecordButton: (props: any) =>
    React.createElement('TouchableOpacity', {
      accessibilityRole: 'button',
      accessibilityLabel: props.isRecording ? 'Stop recording' : 'Start recording',
      onPress: props.onPress,
      disabled: props.disabled || props.isProcessing,
      children: props.isRecording ? '⏹' : '🎙',
    }),
}));

// Mock @testing-library/react-native
let hookIndex = 0;
let stateValues: any[] = [];
let refValues: any[] = [];
let effectCallbacks: Array<() => void> = [];

const mockDispatcher = {
  useState: (initial: any) => {
    const idx = hookIndex++;
    if (stateValues[idx] === undefined) {
      stateValues[idx] = typeof initial === 'function' ? initial() : initial;
    }
    const setState = (next: any) => {
      stateValues[idx] = typeof next === 'function' ? next(stateValues[idx]) : next;
    };
    return [stateValues[idx], setState];
  },
  useRef: (initial: any) => {
    const idx = hookIndex++;
    if (refValues[idx] === undefined) {
      refValues[idx] = { current: initial };
    }
    return refValues[idx];
  },
  useEffect: (effect: () => void) => {
    hookIndex++;
    effectCallbacks.push(effect);
  },
  useCallback: (fn: any) => {
    hookIndex++;
    return fn;
  },
  useMemo: (fn: any) => {
    hookIndex++;
    return fn();
  },
  useSyncExternalStore: (_subscribe: any, getSnapshot: any) => {
    hookIndex++;
    return getSnapshot();
  },
  useId: () => {
    hookIndex++;
    return 'mock-id';
  },
  useDebugValue: () => {},
  useLayoutEffect: (effect: () => void) => {
    hookIndex++;
    effectCallbacks.push(effect);
  },
  useReducer: (reducer: any, initialArg: any, init: any) => {
    const idx = hookIndex++;
    if (stateValues[idx] === undefined) {
      stateValues[idx] = init !== undefined ? init(initialArg) : initialArg;
    }
    const dispatch = (action: any) => {
      stateValues[idx] = reducer(stateValues[idx], action);
    };
    return [stateValues[idx], dispatch];
  },
  useContext: (context: any) => context?._currentValue,
  useTransition: () => [false, (cb: () => void) => cb()],
  useDeferredValue: (value: any) => value,
  useImperativeHandle: () => {},
};

jest.mock('@testing-library/react-native', () => {
  return {
    render: (element: any) => {
      hookIndex = 0;
      const ReactSharedInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      const prevDispatcher = ReactSharedInternals.ReactCurrentDispatcher.current;
      ReactSharedInternals.ReactCurrentDispatcher.current = mockDispatcher;

      const renderNode = (node: any): any => {
        if (!node) return null;
        if (typeof node.type === 'function') {
          try {
            const rendered = node.type(node.props);
            return renderNode(rendered);
          } catch {
            return node;
          }
        }
        const children = node.props?.children;
        if (Array.isArray(children)) {
          return {
            ...node,
            props: {
              ...node.props,
              children: children.map(renderNode),
            },
          };
        } else if (children && typeof children === 'object') {
          return {
            ...node,
            props: {
              ...node.props,
              children: renderNode(children),
            },
          };
        }
        return node;
      };

      let vdom: any;
      try {
        const root = element.type(element.props);
        vdom = renderNode(root);
      } finally {
        ReactSharedInternals.ReactCurrentDispatcher.current = prevDispatcher;
      }

      // Execute mount effects
      const effectsToRun = [...effectCallbacks];
      effectCallbacks = [];
      for (const eff of effectsToRun) {
        eff();
      }

      const findByLabel = (node: any, label: string): any => {
        if (!node) return null;
        if (node.props?.accessibilityLabel === label) {
          return node;
        }
        const children = node.props?.children;
        if (Array.isArray(children)) {
          for (const child of children) {
            const found = findByLabel(child, label);
            if (found) return found;
          }
        } else if (children && typeof children === 'object') {
          return findByLabel(children, label);
        }
        return null;
      };

      const findByType = (node: any, type: any): any => {
        if (!node) return null;
        if (
          node.type === type ||
          (typeof type === 'string' && (node.type?.name === type || node.type?.displayName === type))
        ) {
          return node;
        }
        const children = node.props?.children;
        if (Array.isArray(children)) {
          for (const child of children) {
            const found = findByType(child, type);
            if (found) return found;
          }
        } else if (children && typeof children === 'object') {
          return findByType(children, type);
        }
        return null;
      };

      return {
        getByLabelText: (label: string) => {
          const found = findByLabel(vdom, label);
          if (!found) {
            throw new Error(`Element with label "${label}" not found`);
          }
          return found;
        },
        UNSAFE_getByType: (type: any) => {
          const found = findByType(vdom, type);
          if (!found) {
            throw new Error(`Element with type "${type}" not found`);
          }
          return found;
        },
      };
    },
    fireEvent: {
      press: (node: any) => {
        if (node?.props?.onPress) {
          return node.props.onPress();
        }
      },
    },
    waitFor: async (cb: () => void | Promise<void>, { timeout = 1000, interval = 10 } = {}) => {
      const start = Date.now();
      while (true) {
        try {
          await cb();
          return;
        } catch (err) {
          if (Date.now() - start >= timeout) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, interval));
        }
      }
    },
  };
}, { virtual: true });

// @ts-ignore - virtual module mocked in Jest
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '@/screens/HomeScreen';

describe('HomeScreen Record Button Debounce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hookIndex = 0;
    stateValues = [];
    refValues = [];
    effectCallbacks = [];
    mockRecordingState = 'idle';
    mockNativeAudio.isNativeAvailable = false;
    const { Platform } = require('react-native');
    Platform.OS = 'ios';
  });

  it('ignores a second record tap while recording is already active', async () => {
    const { getByLabelText } = render(React.createElement(HomeScreen));
    const btn = getByLabelText('Start recording');
    fireEvent.press(btn);
    fireEvent.press(btn); // second tap before first resolves
    // only one start() call reaches audioRecorder
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it('falls back to permissionGranted=true when nativeAudio is unavailable', async () => {
    mockNativeAudio.isNativeAvailable = false;
    const { UNSAFE_getByType } = render(React.createElement(HomeScreen));
    const gate = UNSAFE_getByType('PermissionGate');
    expect(gate.props.permissionGranted).toBe(true);
  });

  it('checks PermissionsAndroid when nativeAudio is available on Android', async () => {
    const { Platform, PermissionsAndroid } = require('react-native');
    Platform.OS = 'android';
    mockNativeAudio.isNativeAvailable = true;
    (PermissionsAndroid.check as jest.Mock).mockResolvedValueOnce(false);

    render(React.createElement(HomeScreen));
    await waitFor(() => {
      expect(PermissionsAndroid.check).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
    });
  });

  it('requests permission via PermissionsAndroid on Android when requested', async () => {
    const { Platform, PermissionsAndroid } = require('react-native');
    Platform.OS = 'android';
    mockNativeAudio.isNativeAvailable = true;
    (PermissionsAndroid.check as jest.Mock).mockResolvedValueOnce(false);
    (PermissionsAndroid.request as jest.Mock).mockResolvedValueOnce('granted');

    const { UNSAFE_getByType } = render(React.createElement(HomeScreen));
    const gate = UNSAFE_getByType('PermissionGate');
    await gate.props.onRequestPermission();
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
  });
});
