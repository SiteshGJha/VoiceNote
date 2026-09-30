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
import { useHardwareTrigger } from '@/native/hardwareTrigger';
import { executePipeline } from '@/pipeline/orchestrator';
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

  const vadGateRef = useRef<VadGate | null>(null);
  const handleStopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const isFinalizingRef = useRef<boolean>(false);
  const isStartingRef = useRef<boolean>(false);

  const { recordingState, durationMs, amplitude, start, stop, cancel } = useAudioRecorder({
    onFrame: (chunk) => {
      vadGateRef.current?.processFrame(chunk);
    },
  });

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
        logger.info('HomeScreen', 'VAD auto-stop triggered');
        handleStopRecordingRef.current?.();
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

    // Model guard: verify both ASR and SLM models are installed
    const installed = modelInstaller.listInstalled();
    const hasAsr = installed.some((m) => m.kind === 'asr');
    const hasSlm = installed.some((m) => m.kind === 'slm');

    if (!hasAsr || !hasSlm) {
      isStartingRef.current = false;
      Alert.alert(
        'Models Required',
        'Please download both speech recognition and tone rewriting models from the Models screen before recording.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Models', onPress: () => navigation.navigate('Models') },
        ]
      );
      return;
    }

    try {
      isFinalizingRef.current = false;
      vadGateRef.current?.reset();
      setStage('recording');
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

    const pipelineStartTime = Date.now();
    try {
      setStage('transcribing');
      setPipelineStep('Finalizing audio...');
      const audio = await stop();

      if (!audio) {
        setStage('idle');
        return;
      }

      // VAD & Silence Trimming guard: If audio is 100% silence, short-circuit before ASR
      if (audio.hasSpeech === false) {
        setStage('idle');
        Alert.alert(
          'No Speech Detected',
          'No voice was detected in the audio recording. Please speak clearly into the microphone and try again.',
          [{ text: 'OK' }]
        );
        return;
      }

      setPipelineStep('Transcribing speech offline...');
      const result = await executePipeline(
        audio,
        {
          tone: activeTone,
          lang: activeLanguage,
          hindiOutput: hindiOutputFormat,
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
          navigation.navigate('Result', { result });
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
    }
  };

  handleStopRecordingRef.current = handleStopRecording;

  const isRecording = recordingState === 'recording';
  const isProcessing = stage === 'transcribing' || stage === 'rewriting';

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
          <Text style={[styles.durationText, { color: theme.textMuted }]}>
            {isRecording
              ? `${Math.floor(durationMs / 1000)}s`
              : 'Tap microphone to speak'}
          </Text>
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
              onPress={cancel}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
            >
              <Text style={[styles.cancelButtonText, { color: theme.danger }]}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
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
});
