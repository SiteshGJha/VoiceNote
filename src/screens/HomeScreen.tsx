import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  InteractionManager,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/routes';
import { useAudioRecorder } from '@/audio/useAudioRecorder';
import { nativeAudio } from '@/native/nativeAudio';
import { VadGate } from '@/audio/vadGate';
import { Waveform } from '@/components/Waveform';
import { ToneSelector } from '@/components/ToneSelector';
import { LanguageSelector } from '@/components/LanguageSelector';
import { PermissionGate } from '@/components/PermissionGate';
import { AnimatedRecordButton } from '@/components/AnimatedRecordButton';
import { FirstRunSetupModal } from '@/components/FirstRunSetupModal';
import { Toast } from '@/components/Toast';
import { useHardwareTrigger } from '@/native/hardwareTrigger';
import { executePipeline, startRollingPipelineSession } from '@/pipeline/orchestrator';
import { PipelineResult } from '@/ml/types';
import { RollingSessionController, RollingSessionProgress } from '@/pipeline/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useAppStore } from '@/state/useAppStore';
import { modelInstaller } from '@/services/modelManager';
import { useSystemTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';
import { logger } from '@/utils/logger';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useSystemTheme();

  const defaultTone = useSettingsStore((s) => s.defaultTone);
  const defaultLang = useSettingsStore((s) => s.defaultLanguage);
  const vadSensitivity = useSettingsStore((s) => s.vadSensitivity);
  const hindiOutputFormat = useSettingsStore((s) => s.hindiOutputFormat);
  const autoCopyToClipboard = useSettingsStore((s) => s.autoCopyToClipboard);

  const {
    stage,
    setStage,
    activeTone,
    setActiveTone,
    activeLanguage,
    setActiveLanguage,
    setError,
    setMetrics,
  } = useAppStore();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [pipelineStep, setPipelineStep] = useState<string>('');
  const [showSetupModal, setShowSetupModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<PipelineResult | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<RollingSessionProgress | null>(null);

  const vadGateRef = useRef<VadGate | null>(null);
  const handleStopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const isFinalizingRef = useRef<boolean>(false);
  const isStartingRef = useRef<boolean>(false);
  const rollingSessionRef = useRef<RollingSessionController | null>(null);
  const chunkUnsubRef = useRef<(() => void) | null>(null);
  const ceilingUnsubRef = useRef<(() => void) | null>(null);
  const warned430Ref = useRef<boolean>(false);
  const autoStoppedRef = useRef<boolean>(false);

  const { recordingState, durationMs, amplitude, start, stop, cancel } = useAudioRecorder({
    onFrame: (chunk) => {
      vadGateRef.current?.processFrame(chunk);
    },
  });

  const isRecording = recordingState === 'recording';
  const isProcessing = stage === 'transcribing' || stage === 'rewriting';
  const isWarning430 = isRecording && durationMs >= 270000;
  const isBanner450 = isRecording && durationMs >= 290000;

  useEffect(() => {
    if (isRecording) {
      if (durationMs >= 270000 && !warned430Ref.current) {
        warned430Ref.current = true;
        haptics.trigger('warning');
      }
      if (durationMs >= 300000 && !autoStoppedRef.current) {
        autoStoppedRef.current = true;
        logger.info('HomeScreen', '5-minute limit reached. Auto-stopping recording.');
        handleStopRecordingRef.current?.();
      }
    } else {
      warned430Ref.current = false;
      autoStoppedRef.current = false;
    }
  }, [durationMs, isRecording]);

  const formatDuration = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return `${mm}:${ss} / 05:00`;
  };

  useEffect(() => {
    setActiveTone(defaultTone);
    setActiveLanguage(defaultLang);
  }, [defaultTone, defaultLang, setActiveTone, setActiveLanguage]);

  useEffect(() => {
    const checkMicPermission = async () => {
      if (!nativeAudio.isNativeAvailable) {
        setPermissionGranted(true);
        return;
      }

      if (Platform.OS === 'android' && PermissionsAndroid?.check) {
        try {
          const micPerm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
          if (micPerm) {
            const granted = await PermissionsAndroid.check(micPerm);
            setPermissionGranted(granted);
          } else {
            setPermissionGranted(true);
          }
        } catch {
          setPermissionGranted(false);
        }
      } else {
        setPermissionGranted(true);
      }
    };

    checkMicPermission();
  }, []);

  const handleRequestPermission = async (): Promise<void> => {
    if (Platform.OS === 'android' && PermissionsAndroid?.request) {
      try {
        const micPerm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
        if (micPerm) {
          const result = await PermissionsAndroid.request(micPerm);
          setPermissionGranted(result === PermissionsAndroid.RESULTS.GRANTED);
        } else {
          setPermissionGranted(true);
        }
      } catch {
        setPermissionGranted(false);
      }
    } else {
      setPermissionGranted(true);
    }
  };

  useEffect(() => {
    vadGateRef.current = new VadGate(vadSensitivity, {
      onSpeechStart: () => {
        logger.info('HomeScreen', 'VAD detected speech start');
      },
      onSpeechEnd: () => {
        logger.info('HomeScreen', 'VAD detected speech end, entering silence window');
      },
      onAutoStop: () => {
        // Manual-stop-only for dictation: log event, but do not kill recording while user is thinking
        logger.info('HomeScreen', 'VAD silence threshold reached (manual stop only mode active)');
      },
      onNoSpeech: () => {
        logger.info('HomeScreen', 'VAD detected no speech');
      },
    });
  }, [vadSensitivity]);

  const handleStartRecording = async (): Promise<void> => {
    if (isStartingRef.current) {
      logger.info('HomeScreen', 'Start already in progress, ignoring duplicate trigger');
      return;
    }
    isStartingRef.current = true;

    // Model guard: verify baseline ASR and SLM models are provisioned
    if (!modelInstaller.isProvisioned()) {
      isStartingRef.current = false;
      setShowSetupModal(true);
      return;
    }

    try {
      isFinalizingRef.current = false;
      warned430Ref.current = false;
      autoStoppedRef.current = false;
      setBackgroundProgress(null);
      vadGateRef.current?.reset();
      setStage('recording');

      const session = startRollingPipelineSession(
        {
          tone: activeTone,
          lang: activeLanguage,
          hindiOutput: hindiOutputFormat,
          autoCopy: autoCopyToClipboard,
        },
        (progress) => {
          setBackgroundProgress(progress);
        }
      );
      rollingSessionRef.current = session;

      if (typeof nativeAudio.addChunkReadyListener === 'function') {
        chunkUnsubRef.current = nativeAudio.addChunkReadyListener((event) => {
          logger.info('HomeScreen', `Received native chunk ${event.chunk.index} (${event.chunk.durationMs}ms)`);
          rollingSessionRef.current?.pushChunk(event.chunk);
        });
      }

      if (typeof nativeAudio.addCeilingListener === 'function') {
        ceilingUnsubRef.current = nativeAudio.addCeilingListener(() => {
          logger.info('HomeScreen', 'Native ceiling reached event received');
          handleStopRecordingRef.current?.();
        });
      }

      await start();
    } catch (err) {
      logger.error('HomeScreen', 'Failed to start recording', err);
      setError('AUDIO_RECORD_FAILED', 'Could not access microphone.');
    } finally {
      isStartingRef.current = false;
    }
  };

  const handleStopRecording = async (): Promise<void> => {
    // Debounce: VAD auto-stop and manual tap may both trigger; finalize once.
    if (isFinalizingRef.current) {
      logger.info('HomeScreen', 'Stop already in progress, ignoring duplicate trigger');
      return;
    }
    isFinalizingRef.current = true;

    if (chunkUnsubRef.current) {
      chunkUnsubRef.current();
      chunkUnsubRef.current = null;
    }
    if (ceilingUnsubRef.current) {
      ceilingUnsubRef.current();
      ceilingUnsubRef.current = null;
    }

    const pipelineStartTime = Date.now();
    try {
      setStage('transcribing');
      setPipelineStep('Finalizing audio...');
      const audio = await stop();

      if (!audio) {
        setStage('idle');
        return;
      }

      // VAD & Silence Trimming guard: If audio is 100% silence and no prior chunks, short-circuit before ASR
      if (audio.hasSpeech === false && (!backgroundProgress || backgroundProgress.completedChunks === 0)) {
        setStage('idle');
        await rollingSessionRef.current?.cancelSession();
        rollingSessionRef.current = null;
        Alert.alert(
          'No Speech Detected',
          'No voice was detected in the audio recording. Please speak clearly into the microphone and try again.',
          [{ text: 'OK' }]
        );
        return;
      }

      setPipelineStep('Transcribing speech offline...');
      let result: PipelineResult;

      if (nativeAudio.isNativeAvailable) {
        const trailingChunk = (audio as any)?.trailingChunk;
        if (trailingChunk && rollingSessionRef.current) {
          rollingSessionRef.current.pushChunk(trailingChunk);
        }
        if (rollingSessionRef.current) {
          result = await rollingSessionRef.current.finalizeSession();
        } else {
          result = await executePipeline(audio, {
            tone: activeTone,
            lang: activeLanguage,
            hindiOutput: hindiOutputFormat,
            autoCopy: autoCopyToClipboard,
          });
        }
      } else if (rollingSessionRef.current && backgroundProgress?.completedChunks && backgroundProgress.completedChunks > 0) {
        rollingSessionRef.current.pushChunk({
          uri: audio.uri,
          durationMs: audio.durationMs,
          index: backgroundProgress.completedChunks,
        });
        result = await rollingSessionRef.current.finalizeSession();
      } else {
        result = await executePipeline(
          audio,
          {
            tone: activeTone,
            lang: activeLanguage,
            hindiOutput: hindiOutputFormat,
            autoCopy: autoCopyToClipboard,
          },
          (currentStage) => {
            if (currentStage === 'asr') {
              setStage('transcribing');
              setPipelineStep('Transcribing speech offline...');
            } else if (currentStage === 'slm') {
              setStage('rewriting');
              setPipelineStep('Rewriting tone on-device...');
            } else if (currentStage === 'saving') {
              setPipelineStep('Encrypting note...');
            }
          }
        );
      }

      const totalElapsed = Date.now() - pipelineStartTime;
      if (result.status === 'ok') {
        setMetrics({
          totalDurationMs: totalElapsed,
          asrDurationMs: result.asrDurationMs,
          slmDurationMs: result.slmDurationMs,
        });
      } else {
        setMetrics({
          totalDurationMs: totalElapsed,
        });
      }

      // Off-main-thread responsiveness: run UI transition after interactions complete
      InteractionManager.runAfterInteractions(() => {
        if (result.status === 'ok') {
          haptics.trigger('success');
          setStage('idle');
          if (autoCopyToClipboard) {
            setLastResult(result);
            if (result.usedFallback) {
              setToastMessage('Tone rewriting unavailable — copied raw transcript');
            } else {
              setToastMessage('Copied to clipboard — ready to paste');
            }
            setToastVisible(true);
          } else {
            navigation.navigate('Result', { result });
          }
        } else {
          haptics.trigger('error');
          setStage('error');
          setError(result.code, result.message);
          Alert.alert('Transcription Notice', result.message, [{ text: 'OK' }]);
        }
      });
    } catch (err) {
      logger.error('HomeScreen', 'Error in pipeline execution', err);
      setStage('idle');
    } finally {
      isFinalizingRef.current = false;
      rollingSessionRef.current = null;
    }
  };

  handleStopRecordingRef.current = handleStopRecording;

  const handleCancelRecording = async (): Promise<void> => {
    if (chunkUnsubRef.current) {
      chunkUnsubRef.current();
      chunkUnsubRef.current = null;
    }
    if (ceilingUnsubRef.current) {
      ceilingUnsubRef.current();
      ceilingUnsubRef.current = null;
    }
    if (rollingSessionRef.current) {
      await rollingSessionRef.current.cancelSession();
      rollingSessionRef.current = null;
    }
    setBackgroundProgress(null);
    await cancel();
  };

  // Double-press hardware trigger toggle
  useHardwareTrigger(() => {
    if (isRecording) {
      handleStopRecording();
    } else if (!isProcessing) {
      handleStartRecording();
    }
  });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top action bar */}
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <Text style={[styles.appTitle, { color: theme.textPrimary }]}>VoiceNote</Text>
        <View style={styles.topActions}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }]}
            onPress={() => navigation.navigate('History')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="View history"
          >
            <Text style={styles.iconText}>🕒</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }]}
            onPress={() => navigation.navigate('Models')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Manage on-device models"
          >
            <Text style={styles.iconText}>🧠</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }]}
            onPress={() => navigation.navigate('Settings')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text style={styles.iconText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <PermissionGate
        permissionGranted={permissionGranted ?? true}
        onRequestPermission={handleRequestPermission}
      />

      {/* Main recording body */}
      <View style={styles.content}>
        {/* 5-minute Ceiling Countdown Banner (at 4:50) */}
        {isBanner450 && isRecording && (
          <View testID="ceiling-banner" style={[styles.ceilingBanner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={styles.ceilingBannerText}>
              ⚠️ VoiceNote limit is 5 minutes. Auto-stopping in {Math.max(0, Math.ceil((300000 - durationMs) / 1000))}s...
            </Text>
          </View>
        )}

        {/* Tone and Language selectors */}
        <View style={styles.controlsContainer}>
          <ToneSelector
            selectedTone={activeTone}
            onSelectTone={setActiveTone}
            disabled={isRecording || isProcessing}
          />
          <LanguageSelector
            selectedLang={activeLanguage}
            onSelectLang={setActiveLanguage}
            disabled={isRecording || isProcessing}
          />
        </View>

        {/* Live audio visualizer */}
        <View style={styles.visualizerContainer}>
          <Waveform amplitude={amplitude} isRecording={isRecording} />
          <Text
            testID="duration-text"
            style={[
              styles.durationText,
              { color: isWarning430 ? '#F59E0B' : theme.textMuted },
              isWarning430 && styles.durationWarningText,
            ]}
          >
            {isRecording
              ? formatDuration(durationMs)
              : 'Tap microphone to speak'}
          </Text>

          {/* Background transcription badge */}
          {isRecording && backgroundProgress && backgroundProgress.completedChunks > 0 && (
            <View testID="progress-badge" style={styles.progressBadge}>
              <Text style={[styles.progressBadgeText, { color: theme.primary }]}>
                ⚡ Transcribed {backgroundProgress.completedChunks} {backgroundProgress.completedChunks === 1 ? 'chunk' : 'chunks'} in background
              </Text>
            </View>
          )}
        </View>

        {/* Processing spinner indicator */}
        {isProcessing && (
          <View style={styles.processingCard}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.processingText, { color: theme.textSecondary }]}>
              {pipelineStep}
            </Text>
          </View>
        )}

        {/* Record trigger button */}
        <View style={styles.bottomSection}>
          <AnimatedRecordButton
            isRecording={isRecording}
            isProcessing={isProcessing}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
          />

          {isRecording && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelRecording}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
            >
              <Text style={[styles.cancelButtonText, { color: theme.danger }]}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FirstRunSetupModal
        visible={showSetupModal}
        onDismiss={() => setShowSetupModal(false)}
        onProvisioningComplete={() => {
          setShowSetupModal(false);
          haptics.trigger('success');
        }}
      />

      <Toast
        message={toastMessage}
        visible={toastVisible}
        actionLabel={lastResult?.status === 'ok' ? 'View Note' : undefined}
        onAction={() => {
          setToastVisible(false);
          if (lastResult?.status === 'ok') {
            navigation.navigate('Result', { result: lastResult });
          }
        }}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  controlsContainer: {
    marginTop: 16,
  },
  visualizerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  durationText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  processingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    marginBottom: 16,
  },
  processingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  bottomSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  recordButtonIcon: {
    fontSize: 30,
    color: '#FFFFFF',
  },
  cancelButton: {
    marginTop: 14,
    padding: 8,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  ceilingBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    alignItems: 'center',
  },
  ceilingBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  durationWarningText: {
    fontWeight: '700',
  },
  progressBadge: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  progressBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
