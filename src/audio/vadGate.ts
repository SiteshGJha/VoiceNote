import { VadConfig, VAD_PRESETS, VadSensitivity } from './vadPresets';
import { webrtcVad } from '@/native/webrtcVad';
import { calculateRms } from './wavUtils';
import { logger } from '@/utils/logger';

export type VadState = 'idle' | 'speech' | 'silence';

export interface VadCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onAutoStop?: () => void;
  onNoSpeech?: () => void;
}

export class VadGate {
  private preset: VadSensitivity;
  private config: VadConfig;
  private state: VadState = 'idle';
  private speechDetected = false;
  private consecutiveSpeechMs = 0;
  private consecutiveSilenceMs = 0;
  private totalProcessedMs = 0;
  private callbacks: VadCallbacks;

  constructor(preset: VadSensitivity = 'medium', callbacks: VadCallbacks = {}) {
    this.preset = preset;
    this.config = { ...VAD_PRESETS[preset] };
    this.callbacks = callbacks;
  }

  public setSensitivity(preset: VadSensitivity): void {
    this.preset = preset;
    this.config = { ...VAD_PRESETS[preset] };
    logger.info('VadGate', `VAD sensitivity updated to ${preset}`, this.config);
  }

  public reset(): void {
    this.state = 'idle';
    this.speechDetected = false;
    this.consecutiveSpeechMs = 0;
    this.consecutiveSilenceMs = 0;
    this.totalProcessedMs = 0;
  }

  public getState(): VadState {
    return this.state;
  }

  public hasDetectedSpeech(): boolean {
    return this.speechDetected;
  }

  /**
   * Ingests a single audio frame (typically 20-30 ms).
   * Calculates speech probability and drives auto-stop state machine.
   */
  public processFrame(frameBytes: Uint8Array): {
    isSpeech: boolean;
    probability: number;
    state: VadState;
  } {
    const vadResult = webrtcVad.evaluateFrame(frameBytes, this.preset);
    const probability = vadResult.probability;
    // Frame is speech if probability exceeds configured threshold
    const isSpeech = probability >= this.config.speechThreshold;
    const frameDurationMs = this.config.frameMs;

    this.totalProcessedMs += frameDurationMs;

    if (isSpeech) {
      this.consecutiveSpeechMs += frameDurationMs;
      this.consecutiveSilenceMs = 0;

      // Requires minSpeechMs to filter out short noises like clicks or door slams
      if (this.consecutiveSpeechMs >= this.config.minSpeechMs) {
        if (this.state !== 'speech') {
          this.state = 'speech';
          this.speechDetected = true;
          logger.debug('VadGate', 'Speech started');
          this.callbacks.onSpeechStart?.();
        }
      }
    } else {
      this.consecutiveSilenceMs += frameDurationMs;
      this.consecutiveSpeechMs = 0;

      if (this.state === 'speech') {
        this.state = 'silence';
        logger.debug('VadGate', 'Speech ended, entering silence window');
        this.callbacks.onSpeechEnd?.();
      }

      // If speech was previously active and silence window exceeded, trigger auto-stop
      if (this.speechDetected && this.consecutiveSilenceMs >= this.config.silenceWindowMs) {
        logger.info(
          'VadGate',
          `Auto-stop triggered after ${this.consecutiveSilenceMs}ms silence (threshold: ${this.config.silenceWindowMs}ms)`
        );
        this.callbacks.onAutoStop?.();
      }
    }

    return {
      isSpeech,
      probability,
      state: this.state,
    };
  }

  /**
   * Finalizes the recording session.
   * If no speech was ever detected across the recording, triggers onNoSpeech.
   */
  public finalize(): boolean {
    if (!this.speechDetected) {
      logger.info('VadGate', 'Finalize: No speech was detected during entire session');
      this.callbacks.onNoSpeech?.();
      return false;
    }
    return true;
  }
}
