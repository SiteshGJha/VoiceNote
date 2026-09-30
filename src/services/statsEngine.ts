import { TranscriptionRecord } from './history/types';
import { Lang, Tone } from '@/ml/types';

export interface DailyCount {
  date: string; // 'YYYY-MM-DD' or 'MM' for year view
  words: number;
}

export interface PeriodStats {
  period: 'week' | 'month' | 'year';
  label: string;
  totalWords: number;
  totalNotes: number;
  totalDurationMs: number;
  avgWordsPerNote: number;
  byTone: { professional: number; casual: number };
  byLang: Partial<Record<Lang, number>>;
  dailyCounts: DailyCount[];
  topHour: number | null;
  topHourNoteCount: number;
}

function formatDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pure function to calculate aggregated voice note stats for week, month, or year.
 */
export function computeStats(
  records: TranscriptionRecord[],
  period: 'week' | 'month' | 'year',
  referenceDate: Date = new Date()
): PeriodStats {
  const ref = new Date(referenceDate);

  let startTime: number;
  let endTime: number;
  let label = '';
  const dailyCounts: DailyCount[] = [];

  if (period === 'week') {
    // Current week Monday 00:00:00 to Sunday 23:59:59 UTC
    const dayOfWeek = ref.getUTCDay(); // 0 is Sunday
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - distanceToMonday);
    monday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    sunday.setUTCHours(23, 59, 59, 999);

    startTime = monday.getTime();
    endTime = sunday.getTime();
    label = `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + i);
      dailyCounts.push({
        date: formatDateKey(d),
        words: 0,
      });
    }
  } else if (period === 'month') {
    // 1st of month to last of month
    const year = ref.getUTCFullYear();
    const month = ref.getUTCMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const nextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(nextMonth.getTime() - 1);

    startTime = startOfMonth.getTime();
    endTime = endOfMonth.getTime();
    label = ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const daysInMonth = endOfMonth.getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(year, month, day));
      dailyCounts.push({
        date: formatDateKey(d),
        words: 0,
      });
    }
  } else {
    // Year: Jan 1 to Dec 31
    const year = ref.getUTCFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    startTime = startOfYear.getTime();
    endTime = endOfYear.getTime();
    label = `${year}`;

    for (let m = 0; m < 12; m++) {
      const monthStr = String(m + 1).padStart(2, '0');
      dailyCounts.push({
        date: `${year}-${monthStr}`,
        words: 0,
      });
    }
  }

  const byTone: { professional: number; casual: number } = { professional: 0, casual: 0 };
  const byLang: Partial<Record<Lang, number>> = {};
  const hourCounts: number[] = Array(24).fill(0);

  let totalWords = 0;
  let totalNotes = 0;
  let totalDurationMs = 0;

  for (const record of records) {
    const t = new Date(record.timestamp).getTime();
    if (t < startTime || t > endTime) {
      continue;
    }

    const words =
      record.wordCount ??
      (record.finalText ? record.finalText.trim().split(/\s+/).filter(Boolean).length : 0);

    totalNotes++;
    totalWords += words;
    totalDurationMs += record.durationMs ?? record.audioDurationMs ?? 0;

    // Tone count
    if (record.tone === 'professional' || record.tone === 'casual') {
      byTone[record.tone] += words;
    }

    // Lang count
    const langKey = record.lang as Lang;
    byLang[langKey] = (byLang[langKey] ?? 0) + words;

    // Hour distribution
    const recDate = new Date(record.timestamp);
    const hour = recDate.getUTCHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;

    // Add to daily count
    const recDateKey = formatDateKey(recDate);
    if (period === 'year') {
      const yearMonthKey = recDateKey.slice(0, 7);
      const match = dailyCounts.find((dc) => dc.date === yearMonthKey);
      if (match) match.words += words;
    } else {
      const match = dailyCounts.find((dc) => dc.date === recDateKey);
      if (match) match.words += words;
    }
  }

  // Find top hour
  let maxHourNotes = 0;
  let topHour: number | null = null;
  for (let h = 0; h < 24; h++) {
    if ((hourCounts[h] ?? 0) > maxHourNotes) {
      maxHourNotes = hourCounts[h] ?? 0;
      topHour = h;
    }
  }

  const avgWordsPerNote = totalNotes > 0 ? Math.round(totalWords / totalNotes) : 0;

  return {
    period,
    label,
    totalWords,
    totalNotes,
    totalDurationMs,
    avgWordsPerNote,
    byTone,
    byLang,
    dailyCounts,
    topHour,
    topHourNoteCount: maxHourNotes,
  };
}
