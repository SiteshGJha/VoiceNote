import { ASR_BENCHMARK_FIXTURES, AsrBenchmarkSample } from '../tests/fixtures/asrFixtures';

/**
 * Word Error Rate (WER) and Character Error Rate (CER) Evaluation Harness.
 * Usage: npx ts-node scripts/wer.ts [--model <modelId>] [--lang <en|hi|all>]
 */

export function calculateLevenshteinDistance(ref: string[], hyp: string[]): number {
  const m = ref.length;
  const n = hyp.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

export function computeWer(reference: string, hypothesis: string): number {
  const refWords = reference.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  const distance = calculateLevenshteinDistance(refWords, hypWords);
  return distance / refWords.length;
}

export function computeCer(reference: string, hypothesis: string): number {
  const refChars = reference.trim().toLowerCase().replace(/\s+/g, '').split('');
  const hypChars = hypothesis.trim().toLowerCase().replace(/\s+/g, '').split('');

  if (refChars.length === 0) {
    return hypChars.length === 0 ? 0 : 1;
  }

  const distance = calculateLevenshteinDistance(refChars, hypChars);
  return distance / refChars.length;
}

export interface WerEvaluationResult {
  overallWer: number;
  enWer: number;
  hiWer: number;
  hiCer: number;
  totalSamples: number;
}

export function runWerEvaluation(
  samples: { id: string; reference: string; hypothesis: string; lang: 'en' | 'hi' }[]
): WerEvaluationResult {
  let totalDistance = 0;
  let totalRefWords = 0;

  let enDistance = 0;
  let enWords = 0;

  let hiDistance = 0;
  let hiWords = 0;

  let hiCharDistance = 0;
  let hiTotalChars = 0;

  for (const s of samples) {
    const refWords = s.reference.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hypWords = s.hypothesis.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const dist = calculateLevenshteinDistance(refWords, hypWords);

    totalDistance += dist;
    totalRefWords += refWords.length;

    if (s.lang === 'en') {
      enDistance += dist;
      enWords += refWords.length;
    } else {
      hiDistance += dist;
      hiWords += refWords.length;

      const refChars = s.reference.trim().replace(/\s+/g, '').split('');
      const hypChars = s.hypothesis.trim().replace(/\s+/g, '').split('');
      hiCharDistance += calculateLevenshteinDistance(refChars, hypChars);
      hiTotalChars += refChars.length;
    }
  }

  return {
    overallWer: totalRefWords > 0 ? totalDistance / totalRefWords : 0,
    enWer: enWords > 0 ? enDistance / enWords : 0,
    hiWer: hiWords > 0 ? hiDistance / hiWords : 0,
    hiCer: hiTotalChars > 0 ? hiCharDistance / hiTotalChars : 0,
    totalSamples: samples.length,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let modelId = 'whisper-base-multilingual';
  let langFilter: 'all' | 'en' | 'hi' = 'all';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' && args[i + 1]) {
      modelId = args[++i]!;
    } else if (arg === '--lang' && args[i + 1]) {
      const l = args[++i];
      if (l === 'en' || l === 'hi' || l === 'all') langFilter = l;
    } else if (arg === '--help') {
      // eslint-disable-next-line no-console
      console.log(`
VoiceNote WER/CER Evaluation Tool
Usage:
  npx ts-node scripts/wer.ts [options]

Options:
  --model <modelId>   Whisper model ID (default: whisper-base-multilingual)
  --lang <lang>       Language filter: all | en | hi (default: all)
  --help              Show help message
      `);
      process.exit(0);
    }
  }

  const filteredSamples = ASR_BENCHMARK_FIXTURES.filter((s) =>
    langFilter === 'all' ? true : s.lang === langFilter
  );

  const res = runWerEvaluation(filteredSamples);
  // eslint-disable-next-line no-console
  console.log(`
=== VoiceNote ASR Benchmark Evaluation ===
Model Evaluated:  ${modelId}
Total Samples:    ${res.totalSamples}
Overall WER:      ${(res.overallWer * 100).toFixed(2)}%
English WER:      ${(res.enWer * 100).toFixed(2)}%
Hindi WER:        ${(res.hiWer * 100).toFixed(2)}%
Hindi CER:        ${(res.hiCer * 100).toFixed(2)}%
Target (<12%):    ${res.overallWer < 0.12 ? 'PASS (Target Met)' : 'FAIL (Needs Tuning)'}
`);
}
