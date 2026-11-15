import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { FirstRunSetupModal } from '@/components/FirstRunSetupModal';
import { modelInstaller, storageQuota } from '@/services/modelManager';

describe('FirstRunSetupModal Component', () => {
  const mockOnDismiss = jest.fn();
  const mockOnProvisioningComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    const { queryByText } = render(
      <FirstRunSetupModal
        visible={false}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );
    expect(queryByText('Offline Models Setup')).toBeNull();
  });

  it('renders prompt state with download details when visible', () => {
    const { getByText, getByRole } = render(
      <FirstRunSetupModal
        visible={true}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );

    expect(getByText('Offline Models Setup')).toBeTruthy();
    expect(getByText(/Download Models/)).toBeTruthy();
    expect(getByText('Not Now')).toBeTruthy();
  });

  it('calls onDismiss when Not Now is pressed', () => {
    const { getByText } = render(
      <FirstRunSetupModal
        visible={true}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );

    fireEvent.press(getByText('Not Now'));
    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it('handles immediate completion when models are already provisioned', async () => {
    jest.spyOn(modelInstaller, 'getProvisioningStatus').mockReturnValue({
      isProvisioned: true,
      hasAsr: true,
      hasSlm: true,
      missingSpecs: [],
    });

    const { getByText } = render(
      <FirstRunSetupModal
        visible={true}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );

    await act(async () => {
      fireEvent.press(getByText(/Download Models/));
    });

    expect(mockOnProvisioningComplete).toHaveBeenCalledTimes(1);
  });

  it('displays error and retry options when storage check fails', async () => {
    jest.spyOn(modelInstaller, 'getProvisioningStatus').mockReturnValue({
      isProvisioned: false,
      hasAsr: false,
      hasSlm: false,
      missingSpecs: [
        {
          id: 'whisper-base-multilingual',
          kind: 'asr',
          displayName: 'Whisper Base',
          sizeBytes: 148_000_000,
          version: '1.0.0',
          url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
          sha256: 'abc',
          quant: 'Q5_1',
          minRamGb: 2,
        },
      ],
    });

    jest.spyOn(storageQuota, 'assertSufficientStorage').mockRejectedValueOnce(
      new Error('Disk storage full: insufficient space for models.')
    );

    const { getByText } = render(
      <FirstRunSetupModal
        visible={true}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );

    await act(async () => {
      fireEvent.press(getByText(/Download Models/));
    });

    expect(getByText('Download Interrupted')).toBeTruthy();
    expect(getByText('Disk storage full: insufficient space for models.')).toBeTruthy();
    expect(getByText('Retry Download')).toBeTruthy();
  });

  it('renders Start Dictation button on setup completion and clicking it dismisses modal', async () => {
    jest.spyOn(modelInstaller, 'getProvisioningStatus').mockReturnValue({
      isProvisioned: false,
      hasAsr: false,
      hasSlm: false,
      missingSpecs: [
        {
          id: 'whisper-base-multilingual',
          kind: 'asr',
          displayName: 'Whisper Base',
          sizeBytes: 148_000_000,
          version: '1.0.0',
          url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
          sha256: 'abc',
          quant: 'Q5_1',
          minRamGb: 2,
        },
      ],
    });

    jest.spyOn(storageQuota, 'assertSufficientStorage').mockResolvedValue(undefined as any);
    jest.spyOn(modelInstaller, 'installModel').mockResolvedValue({} as any);

    const { getByText, findByText } = render(
      <FirstRunSetupModal
        visible={true}
        onDismiss={mockOnDismiss}
        onProvisioningComplete={mockOnProvisioningComplete}
      />
    );

    await act(async () => {
      fireEvent.press(getByText(/Download Models/));
    });

    const startButton = await findByText('Start Dictation');
    expect(startButton).toBeTruthy();

    fireEvent.press(startButton);
    expect(mockOnProvisioningComplete).toHaveBeenCalled();
  });
});
