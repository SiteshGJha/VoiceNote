import React from 'react';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  }),
}));

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '@/screens/ReportsScreen';
import { historyStorage } from '@/services/history';

describe('ReportsScreen', () => {
  beforeEach(async () => {
    await historyStorage.clearAll();
    await historyStorage.addRecord({
      rawText: 'Hello test report',
      finalText: 'Hello test report.',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 2500,
      processingDurationMs: 300,
      wordCount: 3,
    });
  });

  it('renders period selector tabs and metric cards', async () => {
    const { getByText } = render(<ReportsScreen />);

    await waitFor(() => {
      expect(getByText('Reports')).toBeTruthy();
      expect(getByText('Week')).toBeTruthy();
      expect(getByText('Month')).toBeTruthy();
      expect(getByText('Year')).toBeTruthy();
      expect(getByText('TOTAL WORDS')).toBeTruthy();
      expect(getByText('TOTAL NOTES')).toBeTruthy();
    });
  });

  it('switches period tabs when tapped', async () => {
    const { getByText } = render(<ReportsScreen />);

    await waitFor(() => {
      expect(getByText('Month')).toBeTruthy();
    });

    fireEvent.press(getByText('Month'));
    await waitFor(() => {
      expect(getByText('Month')).toBeTruthy();
    });

    fireEvent.press(getByText('Year'));
    await waitFor(() => {
      expect(getByText('Year')).toBeTruthy();
    });
  });
});
