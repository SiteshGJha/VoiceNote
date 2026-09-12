import { VadGate } from '@/audio/vadGate';
import { VadSensitivity } from '@/audio/vadPresets';

export interface VadDebugSimulationResult {
  totalFrames: number;
  speechFrames: number;
  silenceFrames: number;
  autoStopTriggered: boolean;
  autoStopFrameIndex: number | null;
}

export function simulateVadFrames(
  frameEnergies: number[], // RMS values for each 30ms frame
  preset: VadSensitivity = 'medium'
): VadDebugSimulationResult {
  let autoStopTriggered = false;
  let autoStopFrameIndex: number | null = null;

  const gate = new VadGate(preset, {
    onAutoStop: () => {
      autoStopTriggered = true;
    },
  });

  let speechCount = 0;
  let silenceCount = 0;

  for (let i = 0; i < frameEnergies.length; i++) {
    const energy = frameEnergies[i] ?? 0;
    // Construct dummy 960-byte frame with equivalent energy
    const dummyFrame = new Uint8Array(960);
    const sampleVal = Math.floor(energy * 8000);
    for (let j = 0; j < 960; j += 2) {
      dummyFrame[j] = sampleVal & 0xff;
      dummyFrame[j + 1] = (sampleVal >> 8) & 0xff;
    }

    const res = gate.processFrame(dummyFrame);
    if (res.isSpeech) {
      speechCount++;
    } else {
      silenceCount++;
    }

    if (autoStopTriggered && autoStopFrameIndex === null) {
      autoStopFrameIndex = i;
    }
  }

  return {
    totalFrames: frameEnergies.length,
    speechFrames: speechCount,
    silenceFrames: silenceCount,
    autoStopTriggered,
    autoStopFrameIndex,
  };
}

if (require.main === module) {
  // eslint-disable-next-line no-console
  console.log('VoiceNote VAD Debug Simulator');
}
