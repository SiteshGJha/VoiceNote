import React from 'react';

// Mocks for React Native and dependencies
const mockNavigate = jest.fn();
let mockRouteParams: any = {
  result: {
    status: 'ok',
    raw: 'Raw captured speech',
    final: 'Initial professional note',
    tone: 'professional',
    lang: 'en',
    totalDurationMs: 1200,
    audioDurationMs: 2500,
    usedFallback: false,
  },
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
  }),
  useRoute: () => ({
    params: mockRouteParams,
  }),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}));

const mockRewrite = jest.fn();
jest.mock('@/ml/slm', () => ({
  rewrite: (...args: any[]) => mockRewrite(...args),
}));

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ResultScreen } from '@/screens/ResultScreen';

describe('ResultScreen Race-Safe Tone Re-rewrite (Task 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {
      result: {
        status: 'ok',
        raw: 'Raw captured speech',
        final: 'Initial professional note',
        tone: 'professional',
        lang: 'en',
        totalDurationMs: 1200,
        audioDurationMs: 2500,
        usedFallback: false,
      },
    };
  });

  it('discards a stale re-rewrite when tone changes again before previous resolves', async () => {
    let resolveFirst!: (v: any) => void;
    const firstCall = new Promise((r) => {
      resolveFirst = r;
    });

    mockRewrite
      .mockReturnValueOnce(firstCall) // first call hangs (casual)
      .mockResolvedValueOnce({
        status: 'ok',
        final: 'casual result', // second call (or professional result)
        tone: 'professional',
        durationMs: 80,
        usedFallback: false,
        fallbackText: '',
      });

    const { getByLabelText, getByText } = render(React.createElement(ResultScreen));

    fireEvent.press(getByLabelText('casual')); // triggers first (hanging) rewrite
    fireEvent.press(getByLabelText('professional')); // triggers second (fast) rewrite

    await waitFor(() => expect(getByText('casual result')).toBeTruthy());
    resolveFirst({
      status: 'ok',
      final: 'stale result',
      tone: 'casual',
      durationMs: 500,
      usedFallback: false,
      fallbackText: '',
    }); // first resolves late

    await new Promise((r) => setTimeout(r, 50));
    expect(() => getByText('stale result')).toThrow(); // stale result discarded
  });

  it('maintains isReRewriting indicator and handles error fallback discarding on stale response', async () => {
    let resolveFirst!: (v: any) => void;
    let resolveSecond!: (v: any) => void;
    const firstCall = new Promise((r) => {
      resolveFirst = r;
    });
    const secondCall = new Promise((r) => {
      resolveSecond = r;
    });

    mockRewrite
      .mockReturnValueOnce(firstCall)
      .mockReturnValueOnce(secondCall);

    const { getByLabelText, getByText, queryByText } = render(React.createElement(ResultScreen));

    expect(queryByText('Rewriting...')).toBeNull();

    // Trigger first rewrite
    fireEvent.press(getByLabelText('casual'));
    expect(getByText('Rewriting...')).toBeTruthy();

    // Trigger second rewrite
    fireEvent.press(getByLabelText('professional'));
    expect(getByText('Rewriting...')).toBeTruthy();

    // First call rejects or returns error fallback late
    resolveFirst({
      status: 'error',
      code: 'SLM_TIMEOUT',
      message: 'SLM timed out',
      fallbackText: 'Stale fallback text',
    });

    await new Promise((r) => setTimeout(r, 20));

    // Stale fallback must NOT overwrite displayText
    expect(() => getByText('Stale fallback text')).toThrow();
    // Indicator must remain active because second rewrite is still running
    expect(getByText('Rewriting...')).toBeTruthy();

    // Second call finishes successfully
    resolveSecond({
      status: 'ok',
      final: 'Fresh professional text',
      tone: 'professional',
      durationMs: 120,
      usedFallback: false,
      fallbackText: '',
    });

    await waitFor(() => {
      expect(queryByText('Rewriting...')).toBeNull();
    });
    expect(getByText('Fresh professional text')).toBeTruthy();
  });
});
