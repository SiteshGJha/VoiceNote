import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { ProgressBar } from '@/components/ProgressBar';
import { modelInstaller, storageQuota } from '@/services/modelManager';
import { useSystemTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';
import { logger } from '@/utils/logger';

export interface FirstRunSetupModalProps {
  visible: boolean;
  onDismiss: () => void;
  onProvisioningComplete: () => void;
}

type SetupStatus = 'idle' | 'checking_storage' | 'downloading' | 'error' | 'success';

export const FirstRunSetupModal: React.FC<FirstRunSetupModalProps> = ({
  visible,
  onDismiss,
  onProvisioningComplete,
}) => {
  const theme = useSystemTheme();
  const [status, setStatus] = useState<SetupStatus>('idle');
  const [currentModelName, setCurrentModelName] = useState<string>('');
  const [currentProgress, setCurrentProgress] = useState<number>(0);
  const [stageIndex, setStageIndex] = useState<number>(1);
  const [totalStages, setTotalStages] = useState<number>(2);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStatus('idle');
      setErrorMessage(null);
      setCurrentProgress(0);
    }
  }, [visible]);

  const provisioningInfo = modelInstaller.getProvisioningStatus();
  const totalDownloadBytes = provisioningInfo.missingSpecs.reduce((sum, spec) => sum + spec.sizeBytes, 0);
  const totalMb = Math.round(totalDownloadBytes / (1024 * 1024)) || 639;

  if (!visible) return null;

  const handleStartSetup = async (): Promise<void> => {
    try {
      setStatus('checking_storage');
      setErrorMessage(null);
      haptics.trigger('impactLight');

      const statusInfo = modelInstaller.getProvisioningStatus();
      const missing = statusInfo.missingSpecs;

      if (missing.length === 0) {
        setStatus('success');
        haptics.trigger('success');
        onProvisioningComplete();
        return;
      }

      setTotalStages(missing.length);

      // 1. Check storage capacity with 20% headroom
      const totalBytes = missing.reduce((sum, spec) => sum + spec.sizeBytes, 0);
      try {
        await storageQuota.assertSufficientStorage(totalBytes);
      } catch (storageErr) {
        setStatus('error');
        setErrorMessage(
          storageErr instanceof Error
            ? storageErr.message
            : 'Insufficient disk storage for offline models.'
        );
        haptics.trigger('error');
        return;
      }

      // 2. Sequentially download and verify each model
      setStatus('downloading');
      for (let i = 0; i < missing.length; i++) {
        const spec = missing[i]!;
        setStageIndex(i + 1);
        setCurrentModelName(spec.displayName);
        setCurrentProgress(0);

        logger.info('FirstRunSetup', `Installing model ${spec.id} (${i + 1}/${missing.length})`);

        await modelInstaller.installModel(spec.id, (percent) => {
          setCurrentProgress(percent);
        });
      }

      setStatus('success');
      haptics.trigger('success');
      setTimeout(() => {
        onProvisioningComplete();
      }, 500);
    } catch (err) {
      logger.error('FirstRunSetup', 'Provisioning failed', err);
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to download offline models. Please try again.'
      );
      haptics.trigger('error');
    }
  };

  return (
    <View style={styles.overlay} accessible={true} accessibilityRole="none">
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={status === 'downloading' ? undefined : onDismiss}
        accessible={false}
      />
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
        accessible={true}
        accessibilityRole="alert"
        accessibilityLabel="Offline Models Setup"
      >
        <Text style={[styles.title, { color: theme.textPrimary }]}>Offline Models Setup</Text>

        {status === 'idle' && (
          <>
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              VoiceNote operates 100% on your device with zero cloud inference. To enable private speech
              recognition and tone rewriting, VoiceNote needs to download the offline speech model weights
              {totalMb > 0 ? ` (~${totalMb} MB)` : ''}.
            </Text>

            <View style={[styles.featureBox, { backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                🔒 100% Offline — No voice audio ever leaves your device
              </Text>
              <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                ⚡ High accuracy English & Hindi transcription
              </Text>
              <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                ✍️ Instant tone rewriting (Professional / Casual)
              </Text>
            </View>

            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.primary }]}
                onPress={handleStartSetup}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Download and setup models"
              >
                <Text style={styles.primaryButtonText}>
                  {totalMb > 0 ? `Download Models (~${totalMb} MB)` : 'Download Models'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onDismiss}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Cancel setup"
              >
                <Text style={[styles.cancelButtonText, { color: theme.textMuted }]}>Not Now</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {status === 'checking_storage' && (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>
              Checking available disk space...
            </Text>
          </View>
        )}

        {status === 'downloading' && (
          <View style={styles.progressContainer}>
            <Text style={[styles.stageHeader, { color: theme.textPrimary }]}>
              Downloading {currentModelName} ({stageIndex}/{totalStages})
            </Text>
            <ProgressBar progress={currentProgress} label="Downloading & verifying cryptographic SHA-256..." />
            <Text style={[styles.helperNote, { color: theme.textMuted }]}>
              Please keep the app open while model weights are downloaded and verified.
            </Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.errorContainer}>
            <Text style={[styles.errorTitle, { color: theme.danger }]}>Download Interrupted</Text>
            <Text style={[styles.errorMessage, { color: theme.textSecondary }]}>
              {errorMessage || 'A network error occurred while downloading model weights.'}
            </Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.primary }]}
                onPress={handleStartSetup}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Retry download"
              >
                <Text style={styles.primaryButtonText}>Retry Download</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onDismiss}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={[styles.cancelButtonText, { color: theme.textMuted }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.progressContainer}>
            <Text style={[styles.successIcon]}>✅</Text>
            <Text style={[styles.stageHeader, { color: theme.textPrimary }]}>Setup Complete!</Text>
            <Text style={[styles.helperNote, { color: theme.textSecondary }]}>
              Offline models are verified and ready for speech recognition.
            </Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.primary }]}
                onPress={onProvisioningComplete}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Start dictation"
              >
                <Text style={styles.primaryButtonText}>Start Dictation</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  featureBox: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    gap: 8,
  },
  featureItem: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  buttonGroup: {
    gap: 10,
  },
  primaryButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelButton: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressContainer: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  stageHeader: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 14,
    marginTop: 10,
  },
  helperNote: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  errorContainer: {
    paddingVertical: 4,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  errorMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
});
