import React from 'react';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  }),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}));

jest.mock('@/components/Header', () => ({
  Header: () => null,
}));

import { render } from '@testing-library/react-native';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { historyStorage } from '@/services/history';

describe('HistoryScreen: Empty State + Loading State', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows loading spinner before records resolve', async () => {
    jest.spyOn(historyStorage, 'listRecords').mockImplementation(
      () => new Promise(() => {})
    );
    const { getByTestId } = render(React.createElement(HistoryScreen));
    expect(getByTestId('history-loading')).toBeTruthy();
  });

  it('shows empty-state message when records is empty array', async () => {
    jest.spyOn(historyStorage, 'listRecords').mockResolvedValue([]);
    const { findByText } = render(React.createElement(HistoryScreen));
    expect(await findByText(/no notes yet/i)).toBeTruthy();
  });

  it('renders record items and hides loading spinner when records resolve', async () => {
    const mockRecord = {
      id: 'rec-1',
      timestamp: new Date().toISOString(),
      rawText: 'Hello world',
      finalText: 'Hello world.',
      tone: 'professional' as const,
      lang: 'en' as const,
      audioDurationMs: 1000,
      processingDurationMs: 500,
    };
    jest.spyOn(historyStorage, 'listRecords').mockResolvedValue([mockRecord]);
    const { findByText, queryByTestId } = render(React.createElement(HistoryScreen));
    expect(await findByText('Hello world.')).toBeTruthy();
    expect(queryByTestId('history-loading')).toBeNull();
  });

  it('does not update state when unmounted before records resolve', async () => {
    let resolvePromise: (records: any[]) => void = () => {};
    jest.spyOn(historyStorage, 'listRecords').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );
    const { unmount, queryByTestId } = render(React.createElement(HistoryScreen));
    expect(queryByTestId('history-loading')).toBeTruthy();
    unmount();
    resolvePromise([]);
  });

  it('filters notes when user types into the search bar', async () => {
    const r1 = {
      id: 'rec-1',
      timestamp: new Date().toISOString(),
      rawText: 'Apple banana cherry',
      finalText: 'Apple banana cherry.',
      tone: 'professional' as const,
      lang: 'en' as const,
      audioDurationMs: 1000,
      processingDurationMs: 500,
    };
    const r2 = {
      id: 'rec-2',
      timestamp: new Date().toISOString(),
      rawText: 'Dog elephant fox',
      finalText: 'Dog elephant fox.',
      tone: 'casual' as const,
      lang: 'en' as const,
      audioDurationMs: 1000,
      processingDurationMs: 500,
    };

    jest.spyOn(historyStorage, 'listRecords').mockResolvedValue([r1, r2]);
    const { findByText, queryByText, getByPlaceholderText } = render(
      React.createElement(HistoryScreen)
    );

    expect(await findByText('Apple banana cherry.')).toBeTruthy();
    expect(await findByText('Dog elephant fox.')).toBeTruthy();

    const searchInput = getByPlaceholderText(/search/i);
    searchInput.props.onChangeText('Apple');

    expect(await findByText('Apple banana cherry.')).toBeTruthy();
    expect(queryByText('Dog elephant fox.')).toBeNull();
  });
});
