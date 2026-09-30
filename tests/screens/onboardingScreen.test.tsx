import React from 'react';

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    navigate: jest.fn(),
    goBack: jest.fn(),
  }),
}));

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { useSettingsStore } from '@/state/useSettingsStore';

describe('OnboardingScreen', () => {
  beforeEach(() => {
    useSettingsStore.setState({ hasCompletedOnboarding: false });
    mockReplace.mockClear();
  });

  it('renders initial welcome slide', async () => {
    const { getByText } = render(<OnboardingScreen />);

    expect(getByText('Welcome to VoiceNote')).toBeTruthy();
    expect(getByText('Step 1 of 4')).toBeTruthy();
    expect(getByText('Skip')).toBeTruthy();
  });

  it('progresses to next slides when Next is pressed', async () => {
    const { getByText } = render(<OnboardingScreen />);

    fireEvent.press(getByText('Next →'));
    expect(getByText('On-Device AI Models')).toBeTruthy();
    expect(getByText('Step 2 of 4')).toBeTruthy();

    fireEvent.press(getByText('Next →'));
    expect(getByText('Personalize Defaults')).toBeTruthy();
    expect(getByText('Step 3 of 4')).toBeTruthy();

    fireEvent.press(getByText('Next →'));
    expect(getByText("You're All Set!")).toBeTruthy();
    expect(getByText('Step 4 of 4')).toBeTruthy();
  });

  it('finishes onboarding and navigates to Home on Get Started or Skip', async () => {
    const { getByText } = render(<OnboardingScreen />);

    fireEvent.press(getByText('Skip'));
    expect(useSettingsStore.getState().hasCompletedOnboarding).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('Home');
  });
});
