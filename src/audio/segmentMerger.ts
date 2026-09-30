/**
 * Segment Merger
 * Deduplicates overlap regions between adjacent speech transcription segments.
 * Uses suffix/prefix token matching with Levenshtein tolerance.
 */

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[.,!?;:"'()]/g, '');
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

/**
 * Merge two adjacent transcript segments by deduplicating overlap.
 */
function mergeTwoSegments(left: string, right: string): string {
  const leftTrim = left.trim();
  const rightTrim = right.trim();

  if (!leftTrim) return rightTrim;
  if (!rightTrim) return leftTrim;

  const leftTokens = leftTrim.split(/\s+/);
  const rightTokens = rightTrim.split(/\s+/);

  // Look for match of length k where suffix of leftTokens matches prefix of rightTokens
  // Maximum overlap window: up to 15 tokens (~5s speech at 150wpm is ~12-15 words)
  const maxK = Math.min(leftTokens.length, rightTokens.length, 16);

  let bestOverlapLength = 0;

  for (let k = maxK; k >= 2; k--) {
    const leftSlice = leftTokens.slice(-k);
    const rightSlice = rightTokens.slice(0, k);

    // Compute token-level distance
    let diff = 0;
    for (let i = 0; i < k; i++) {
      const t1 = normalizeToken(leftSlice[i] ?? '');
      const t2 = normalizeToken(rightSlice[i] ?? '');
      if (t1 !== t2) {
        // Character level Levenshtein tolerance
        const dist = levenshteinDistance(t1, t2);
        const maxLen = Math.max(t1.length, t2.length);
        if (maxLen > 0 && dist / maxLen > 0.25) {
          diff++;
        }
      }
    }

    // Allow at most 1 token mismatch per 4 tokens
    if (diff <= Math.floor(k * 0.25)) {
      bestOverlapLength = k;
      break;
    }
  }

  if (bestOverlapLength > 0) {
    const nonOverlappingRight = rightTokens.slice(bestOverlapLength).join(' ');
    return nonOverlappingRight ? `${leftTrim} ${nonOverlappingRight}` : leftTrim;
  }

  return `${leftTrim} ${rightTrim}`;
}

/**
 * Merges an array of transcribed audio segments.
 */
export function mergeSegments(segments: string[]): string {
  if (segments.length === 0) return '';
  if (segments.length === 1) return segments[0] ?? '';

  let merged = segments[0] ?? '';
  for (let i = 1; i < segments.length; i++) {
    const nextSeg = segments[i];
    if (nextSeg) {
      merged = mergeTwoSegments(merged, nextSeg);
    }
  }

  return merged;
}
