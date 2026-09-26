import * as fs from 'fs';
import * as path from 'path';
import { VadGate, VadState } from '@/audio/vadGate';
import { VadSensitivity, VAD_PRESETS } from '@/audio/vadPresets';

export interface VadDebugSimulationResult {
  totalFrames: number;
  speechFrames: number;
  silenceFrames: number;
  autoStopTriggered: boolean;
  autoStopFrameIndex: number | null;
}

export interface FrameDebugInfo {
  frameIndex: number;
  timeMs: number;
  probability: number;
  isSpeech: boolean;
  state: VadState;
}

export interface VadFileDebugResult extends VadDebugSimulationResult {
  filePath: string;
  preset: VadSensitivity;
  totalDurationMs: number;
  speechDurationMs: number;
  silenceDurationMs: number;
  htmlReportPath?: string;
  frames: FrameDebugInfo[];
}

/**
 * Simulates VAD frame processing given an array of frame energies.
 */
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

/**
 * Generates an HTML visualization with SVG timeline for frame probabilities and VAD states.
 */
export function generateVadHtmlReport(
  result: VadFileDebugResult,
  outputPath: string
): void {
  const width = 900;
  const height = 320;
  const padding = 50;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const totalFrames = Math.max(result.frames.length, 1);
  const threshold = VAD_PRESETS[result.preset].speechThreshold;
  const thresholdY = padding + plotHeight * (1 - threshold);

  // SVG polyline points for probability
  const points = result.frames
    .map((f, i) => {
      const x = padding + (i / totalFrames) * plotWidth;
      const y = padding + plotHeight * (1 - Math.min(Math.max(f.probability, 0), 1));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // SVG speech regions
  const speechRects = result.frames
    .map((f, i) => {
      if (!f.isSpeech) return '';
      const x = padding + (i / totalFrames) * plotWidth;
      const w = Math.max(plotWidth / totalFrames, 1.5);
      return `<rect x="${x.toFixed(1)}" y="${padding}" width="${w.toFixed(1)}" height="${plotHeight}" fill="#34C759" opacity="0.18" />`;
    })
    .filter(Boolean)
    .join('\n');

  // Auto-stop indicator line
  let autoStopMarker = '';
  if (result.autoStopFrameIndex !== null) {
    const stopX = padding + (result.autoStopFrameIndex / totalFrames) * plotWidth;
    autoStopMarker = `
      <line x1="${stopX.toFixed(1)}" y1="${padding}" x2="${stopX.toFixed(1)}" y2="${padding + plotHeight}" stroke="#FF3B30" stroke-width="2" stroke-dasharray="4,4" />
      <text x="${(stopX + 6).toFixed(1)}" y="${padding + 20}" font-family="monospace" font-size="11" fill="#FF3B30" font-weight="bold">Auto-Stop (${result.autoStopFrameIndex * 30}ms)</text>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>VoiceNote VAD Debug Plot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0F172A; color: #F8FAFC; margin: 0; padding: 24px; }
    .card { max-width: 960px; margin: 0 auto; background: #1E293B; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 22px; color: #38BDF8; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-box { background: #334155; padding: 12px 16px; border-radius: 8px; }
    .stat-box span { display: block; font-size: 11px; text-transform: uppercase; color: #94A3B8; margin-bottom: 4px; }
    .stat-box strong { font-size: 18px; color: #F1F5F9; }
    svg { background: #0F172A; border-radius: 8px; width: 100%; height: auto; display: block; }
    .legend { display: flex; gap: 20px; margin-top: 14px; font-size: 12px; color: #94A3B8; }
    .legend-item { display: flex; alignItems: center; gap: 6px; }
    .badge { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Voice Activity Detection Analysis</h1>
    <div class="stats">
      <div class="stat-box"><span>Preset</span><strong>${result.preset.toUpperCase()}</strong></div>
      <div class="stat-box"><span>Total Duration</span><strong>${result.totalDurationMs} ms</strong></div>
      <div class="stat-box"><span>Speech Duration</span><strong>${result.speechDurationMs} ms (${result.speechFrames} frames)</strong></div>
      <div class="stat-box"><span>Silence Duration</span><strong>${result.silenceDurationMs} ms (${result.silenceFrames} frames)</strong></div>
      <div class="stat-box"><span>Auto-Stop</span><strong style="color: ${result.autoStopTriggered ? '#34C759' : '#F59E0B'}">${result.autoStopTriggered ? 'Triggered' : 'Not triggered'}</strong></div>
    </div>

    <svg viewBox="0 0 ${width} ${height}">
      <!-- Background Grid -->
      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#334155" stroke-width="1" />
      <line x1="${padding}" y1="${padding + plotHeight * 0.5}" x2="${width - padding}" y2="${padding + plotHeight * 0.5}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2" />
      <line x1="${padding}" y1="${padding + plotHeight}" x2="${width - padding}" y2="${padding + plotHeight}" stroke="#334155" stroke-width="1" />

      <!-- Speech Regions -->
      ${speechRects}

      <!-- Speech Threshold Line -->
      <line x1="${padding}" y1="${thresholdY.toFixed(1)}" x2="${width - padding}" y2="${thresholdY.toFixed(1)}" stroke="#EAB308" stroke-width="1.5" stroke-dasharray="5,5" />
      <text x="${padding + 6}" y="${(thresholdY - 6).toFixed(1)}" font-family="monospace" font-size="11" fill="#EAB308">Threshold: ${threshold}</text>

      <!-- Probability Line -->
      <polyline fill="none" stroke="#38BDF8" stroke-width="2" points="${points}" />

      <!-- Auto-stop marker -->
      ${autoStopMarker}

      <!-- Axis Labels -->
      <text x="${padding}" y="${height - 15}" font-family="sans-serif" font-size="11" fill="#94A3B8">0s</text>
      <text x="${width - padding - 30}" y="${height - 15}" font-family="sans-serif" font-size="11" fill="#94A3B8">${(result.totalDurationMs / 1000).toFixed(1)}s</text>
      <text x="15" y="${padding + 12}" font-family="sans-serif" font-size="11" fill="#94A3B8">1.0</text>
      <text x="15" y="${padding + plotHeight}" font-family="sans-serif" font-size="11" fill="#94A3B8">0.0</text>
    </svg>

    <div class="legend">
      <div class="legend-item"><span class="badge" style="background: #38BDF8;"></span> Speech Probability</div>
      <div class="legend-item"><span class="badge" style="background: #EAB308;"></span> Speech Threshold</div>
      <div class="legend-item"><span class="badge" style="background: rgba(52, 199, 89, 0.4);"></span> Detected Speech</div>
      <div class="legend-item"><span class="badge" style="background: #FF3B30;"></span> Auto-Stop</div>
    </div>
  </div>
</body>
</html>`;

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, html, 'utf8');
}

/**
 * Runs VAD debugging on a WAV file or synthetic frame stream and outputs statistics & HTML plot.
 */
export function debugVadFile(
  filePath: string,
  preset: VadSensitivity = 'medium',
  htmlReportPath = 'tmp/vad.html'
): VadFileDebugResult {
  let pcmBytes: Uint8Array;

  if (fs.existsSync(filePath)) {
    const rawBuffer = fs.readFileSync(filePath);
    // If standard 44-byte WAV header present, skip it
    if (
      rawBuffer.length > 44 &&
      rawBuffer.toString('ascii', 0, 4) === 'RIFF' &&
      rawBuffer.toString('ascii', 8, 12) === 'WAVE'
    ) {
      pcmBytes = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset + 44, rawBuffer.byteLength - 44);
    } else {
      pcmBytes = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);
    }
  } else {
    // Generate synthetic audio for testing/demo (3 seconds: 1s speech, 2s silence)
    const frameCount = 100; // 3000ms
    pcmBytes = new Uint8Array(frameCount * 960);
    const view = new DataView(pcmBytes.buffer);
    for (let i = 0; i < frameCount; i++) {
      const isSpeech = i >= 10 && i < 40; // 300ms to 1200ms
      const level = isSpeech ? 5000 : 200;
      for (let j = 0; j < 480; j++) {
        view.setInt16((i * 480 + j) * 2, level, true);
      }
    }
  }

  const frameBytes = 960; // 30 ms @ 16 kHz 16-bit mono
  const totalFrames = Math.floor(pcmBytes.length / frameBytes);
  const frames: FrameDebugInfo[] = [];

  let autoStopTriggered = false;
  let autoStopFrameIndex: number | null = null;
  let speechFrames = 0;
  let silenceFrames = 0;

  const gate = new VadGate(preset, {
    onAutoStop: () => {
      autoStopTriggered = true;
    },
  });

  for (let i = 0; i < totalFrames; i++) {
    const start = i * frameBytes;
    const slice = pcmBytes.subarray(start, start + frameBytes);
    const result = gate.processFrame(slice);

    if (result.isSpeech) {
      speechFrames++;
    } else {
      silenceFrames++;
    }

    if (autoStopTriggered && autoStopFrameIndex === null) {
      autoStopFrameIndex = i;
    }

    frames.push({
      frameIndex: i,
      timeMs: i * 30,
      probability: result.probability,
      isSpeech: result.isSpeech,
      state: result.state,
    });
  }

  const result: VadFileDebugResult = {
    filePath,
    preset,
    totalFrames,
    speechFrames,
    silenceFrames,
    autoStopTriggered,
    autoStopFrameIndex,
    totalDurationMs: totalFrames * 30,
    speechDurationMs: speechFrames * 30,
    silenceDurationMs: silenceFrames * 30,
    htmlReportPath,
    frames,
  };

  generateVadHtmlReport(result, htmlReportPath);
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let file = 'sample.wav';
  let preset: VadSensitivity = 'medium';
  let out = 'tmp/vad.html';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' && args[i + 1]) {
      file = args[++i]!;
    } else if (arg === '--preset' && args[i + 1]) {
      const p = args[++i] as VadSensitivity;
      if (p === 'low' || p === 'medium' || p === 'high') {
        preset = p;
      }
    } else if (arg === '--out' && args[i + 1]) {
      out = args[++i]!;
    } else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(`
VoiceNote VAD Debug Simulator
Usage:
  npx ts-node scripts/vad-debug.ts [options]

Options:
  --file <path>       WAV audio file to inspect (default: sample.wav / synthetic)
  --preset <preset>   VAD sensitivity preset: low | medium | high (default: medium)
  --out <path>        Output HTML report plot path (default: tmp/vad.html)
  --help              Display this message
      `);
      process.exit(0);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Analyzing audio with VAD preset: ${preset}...`);
  const res = debugVadFile(file, preset, out);
  // eslint-disable-next-line no-console
  console.log(`
=== VAD Simulation Results ===
File:              ${res.filePath}
Preset:            ${res.preset}
Total Frames:      ${res.totalFrames} (${res.totalDurationMs} ms)
Speech Frames:     ${res.speechFrames} (${res.speechDurationMs} ms)
Silence Frames:    ${res.silenceFrames} (${res.silenceDurationMs} ms)
Auto-stop:         ${res.autoStopTriggered ? `Fired at frame ${res.autoStopFrameIndex} (${(res.autoStopFrameIndex ?? 0) * 30} ms)` : 'Did not trigger'}
HTML Report:       ${path.resolve(out)}
`);
}
