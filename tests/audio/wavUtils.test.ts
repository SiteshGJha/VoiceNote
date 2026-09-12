import {
  createWavHeader,
  wrapPcmWithWavHeader,
  calculateRms,
  calculateDurationMs,
  SAMPLE_RATE,
  CHANNELS,
  BITS_PER_SAMPLE,
} from '@/audio/wavUtils';

describe('wavUtils', () => {
  it('creates a standard 44-byte WAV header for 16 kHz 16-bit mono PCM', () => {
    const pcmLength = 32000; // 1 second of audio
    const header = createWavHeader(pcmLength);

    expect(header.length).toBe(44);

    // Verify RIFF identifier
    const riff = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!);
    expect(riff).toBe('RIFF');

    // Verify WAVE identifier
    const wave = String.fromCharCode(header[8]!, header[9]!, header[10]!, header[11]!);
    expect(wave).toBe('WAVE');

    const view = new DataView(header.buffer);
    expect(view.getUint16(20, true)).toBe(1); // Linear PCM
    expect(view.getUint16(22, true)).toBe(CHANNELS); // 1
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE); // 16000
    expect(view.getUint16(34, true)).toBe(BITS_PER_SAMPLE); // 16
    expect(view.getUint32(40, true)).toBe(pcmLength); // Data chunk size
  });

  it('wraps raw PCM bytes with valid 44-byte header', () => {
    const pcm = new Uint8Array(1600); // 50 ms
    const wav = wrapPcmWithWavHeader(pcm);

    expect(wav.length).toBe(1644);
    expect(wav.slice(44)).toEqual(pcm);
  });

  it('calculates duration in milliseconds correctly', () => {
    const oneSecBytes = 16000 * 2; // 32000 bytes
    expect(calculateDurationMs(oneSecBytes)).toBe(1000);
    expect(calculateDurationMs(oneSecBytes * 5)).toBe(5000);
  });

  it('calculates RMS and normalized amplitude', () => {
    const silence = new Uint8Array(960);
    const { rms: silenceRms, normalized: silenceNorm } = calculateRms(silence);
    expect(silenceRms).toBe(0);
    expect(silenceNorm).toBe(0);

    // Full scale sine or DC wave
    const active = new Uint8Array(960);
    const view = new DataView(active.buffer);
    for (let i = 0; i < 480; i++) {
      view.setInt16(i * 2, 4000, true);
    }
    const { rms, normalized } = calculateRms(active);
    expect(rms).toBe(4000);
    expect(normalized).toBe(0.5);
  });
});
