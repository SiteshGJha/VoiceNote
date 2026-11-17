import React from 'react';

// Mocks for React Native and dependencies
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

let currentDurationMs = 0;
let currentRecordingState = 'recording';
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue({
  uri: '/mock/trailing.wav',
  durationMs: 300000,
  sampleRate: 16000,
  channels: 1,
  byteLength: 9600000,
  hasSpeech: true,
});
const mockCancel = jest.fn().mockResolvedValue(undefined);

jest.mock('@/audio/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    recordingState: currentRecordingState,
    durationMs: currentDurationMs,
    amplitude: 0.05,
    start: mockStart,
    stop: mockStop,
    cancel: mockCancel,
  }),
}));

jest.mock('@/services/modelManager', () => ({
  modelInstaller: {
    initialize: jest.fn().mockResolvedValue(undefined),
    isProvisioned: () => true,
  },
}));

jest.mock('@/native/nativeAudio', () => ({
  nativeAudio: {
    isNativeAvailable: false,
    addChunkReadyListener: jest.fn().mockReturnValue(() => {}),
    addCeilingListener: jest.fn().mockReturnValue(() => {}),
    addMeteringListener: jest.fn().mockReturnValue(() => {}),
    startRollingRecording: jest.fn().mockResolvedValue(true),
    stopRollingRecording: jest.fn().mockResolvedValue(null),
    cancelRollingRecording: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/native/hardwareTrigger', () => ({
  useHardwareTrigger: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
  NativeModules: {},
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
    flatten: (s: any) => (Array.isArray(s) ? Object.assign({}, ...s) : s || {}),
  },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  SafeAreaView: 'SafeAreaView',
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    currentState: 'active',
  },
  Appearance: {
    getColorScheme: jest.fn().mockReturnValue('light'),
    addChangeListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  },
}));

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

function renderComponent(element: any): any {
  hookIndex = 0;
  stateValues = [];
  refValues = [];
  effectCallbacks = [];

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

  // Run effects
  for (const eff of effectCallbacks) {
    eff();
  }

  return vdom;
}

function findElementByTestId(node: any, testId: string): any {
  if (!node) return null;
  if (node.props?.testID === testId) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElementByTestId(child, testId);
      if (found) return found;
    }
  } else if (children && typeof children === 'object') {
    return findElementByTestId(children, testId);
  }
  return null;
}

import { HomeScreen } from '@/screens/HomeScreen';

describe('HomeScreen 5-Minute Ceiling State Machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentDurationMs = 0;
    currentRecordingState = 'recording';
  });

  it('formats duration as MM:SS / 05:00 at normal recording time', () => {
    currentDurationMs = 65000; // 1m 05s
    const tree = renderComponent(React.createElement(HomeScreen));
    const durationNode = findElementByTestId(tree, 'duration-text');
    expect(durationNode).not.toBeNull();
    expect(durationNode.props.children).toBe('01:05 / 05:00');
    expect(durationNode.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#868E96' })])
    );
  });

  it('switches duration text to amber and triggers haptic warning at 4:30 (270s)', () => {
    currentDurationMs = 270000; // 4m 30s
    const tree = renderComponent(React.createElement(HomeScreen));
    const durationNode = findElementByTestId(tree, 'duration-text');
    expect(durationNode.props.children).toBe('04:30 / 05:00');
    expect(durationNode.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#F59E0B' })])
    );
  });

  it('displays countdown banner at 4:50 (290s)', () => {
    currentDurationMs = 290000; // 4m 50s
    const tree = renderComponent(React.createElement(HomeScreen));
    const bannerNode = findElementByTestId(tree, 'ceiling-banner');
    expect(bannerNode).not.toBeNull();
  });
});
