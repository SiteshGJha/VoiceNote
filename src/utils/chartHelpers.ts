export interface BarChartLayoutItem {
  key: string;
  label: string;
  value: number;
  heightPercent: number; // 0 to 100
}

/**
 * Computes simple bar layout dimensions for pure React Native UI rendering.
 */
export function calculateBarLayout(
  items: Array<{ date: string; words: number }>,
  maxBars: number = 31
): BarChartLayoutItem[] {
  const slice = items.slice(-maxBars);
  const maxVal = Math.max(...slice.map((i) => i.words), 1);

  return slice.map((item) => {
    // Label: extract day or month
    const parts = item.date.split('-');
    const label = parts.length === 3 ? parts[2] ?? '' : parts[1] ?? '';
    const heightPercent = Math.round((item.words / maxVal) * 100);

    return {
      key: item.date,
      label,
      value: item.words,
      heightPercent: Math.max(heightPercent, 4), // Min 4% for visible indicator
    };
  });
}
