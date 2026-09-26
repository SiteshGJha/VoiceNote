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
      () => new Promise((r) => setTimeout(() => r([]), 100))
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
});
