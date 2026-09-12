/**
 * Utility functions for 16 kHz 16-bit mono PCM / WAV handling.
 * Whisper and WebRTC VAD require 16 kHz 16-bit mono PCM.
 */

export const SAMPLE_RATE = 16000;
export const CHANNELS = 1;
export const BITS_PER_SAMPLE = 16;
export const BYTES_PER_SAMPLE = 2; // 16 bits = 2 bytes

/**
 * Creates a standard 44-byte RIFF/WAVE header for linear PCM audio.
 *
 * @param pcmDataLength Total byte length of raw PCM samples
 * @param sampleRate Default 16000 Hz
 * @param numChannels Default 1 (mono)
 * @param bitsPerSample Default 16 bits
 */
export function createWavHeader(
  pcmDataLength: number,
  sampleRate: number = SAMPLE_RATE,
  numChannels: number = CHANNELS,
  bitsPerSample: number = BITS_PER_SAMPLE
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  // RIFF chunk descriptor
  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + pcmDataLength, true); // ChunkSize = 36 + SubChunk2Size
  header.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // "fmt " sub-chunk
  header.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size = 16 for PCM
  view.setUint16(20, 1, true); // AudioFormat = 1 (Linear PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  header.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, pcmDataLength, true); // Subchunk2Size

  return header;
}

/**
 * Combines raw 16-bit PCM bytes with a standard WAV header.
 */
export function wrapPcmWithWavHeader(pcmBytes: Uint8Array): Uint8Array {
  const header = createWavHeader(pcmBytes.length);
  const fullWav = new Uint8Array(header.length + pcmBytes.length);
  fullWav.set(header, 0);
  fullWav.set(pcmBytes, header.length);
  return fullWav;
}

/**
 * Calculates root-mean-square (RMS) and normalized amplitude (0.0 to 1.0)
 * from 16-bit signed PCM samples.
 */
export function calculateRms(pcmBytes: Uint8Array): { rms: number; normalized: number } {
  if (pcmBytes.length < 2) {
    return { rms: 0, normalized: 0 };
  }

  const sampleCount = Math.floor(pcmBytes.length / 2);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true);
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  // Max value for 16-bit signed audio is 32768. Normalize with gentle log curve for UI
  const normalized = Math.min(1.0, Math.max(0.0, rms / 8000));

  return { rms, normalized };
}

/**
 * Calculates duration in milliseconds of 16 kHz 16-bit mono PCM.
 */
export function calculateDurationMs(pcmByteLength: number): number {
  const bytesPerSecond = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  return Math.round((pcmByteLength / bytesPerSecond) * 1000);
}
