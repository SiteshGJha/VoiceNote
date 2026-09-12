/**
 * Word Error Rate (WER) and Character Error Rate (CER) Evaluation Harness.
 * Usage: npx ts-node scripts/wer.ts [--model <modelId>] [--fixtures <dir>]
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

export function runWerEvaluation(
  samples: { id: string; reference: string; hypothesis: string; lang: 'en' | 'hi' }[]
): {
  overallWer: number;
  enWer: number;
  hiWer: number;
  totalSamples: number;
} {
  let totalDistance = 0;
  let totalRefWords = 0;

  let enDistance = 0;
  let enWords = 0;

  let hiDistance = 0;
  let hiWords = 0;

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
    }
  }

  return {
    overallWer: totalRefWords > 0 ? totalDistance / totalRefWords : 0,
    enWer: enWords > 0 ? enDistance / enWords : 0,
    hiWer: hiWords > 0 ? hiDistance / hiWords : 0,
    totalSamples: samples.length,
  };
}

if (require.main === module) {
  // eslint-disable-next-line no-console
  console.log('VoiceNote WER Evaluation Tool');
}
