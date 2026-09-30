import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface WaveformProps {
  amplitude: number; // 0.0 to 1.0
  isRecording: boolean;
  barCount?: number;
  throttleMs?: number;
}

export const Waveform: React.FC<WaveformProps> = ({
  amplitude,
  isRecording,
  barCount = 28,
  throttleMs = process.env.NODE_ENV === 'test' ? 0 : 60,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const baselineBars = useMemo(() => new Array(barCount).fill(0.1), [barCount]);
  const barsRef = useRef<number[]>(baselineBars);
  const lastUpdateMsRef = useRef<number>(0);
  const [bars, setBars] = useState<number[]>(baselineBars);

  useEffect(() => {
    if (!isRecording) {
      barsRef.current = baselineBars;
      setBars(baselineBars);
      return;
    }

    const now = Date.now();
    // Throttle to prevent UI thread thrashing on long recordings (allow initial frame)
    if (throttleMs > 0 && lastUpdateMsRef.current !== 0 && now - lastUpdateMsRef.current < throttleMs) {
      return;
    }
    lastUpdateMsRef.current = now;

    const prevHeight = barsRef.current[barsRef.current.length - 1] ?? 0.1;
    // Deterministic low-pass filter: smooth amplitude transitions without Math.random() jitter
    const height = Math.min(1.0, Math.max(0.1, prevHeight * 0.7 + amplitude * 0.3));
    const next = [...barsRef.current.slice(1), height];
    barsRef.current = next;
    setBars(next);
  }, [amplitude, isRecording, barCount, baselineBars, throttleMs]);

  // Synchronously reset to baseline 0.1 height when recording is idle/stopped/cancelled
  const displayBars = isRecording ? bars : baselineBars;

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={isRecording ? 'Audio waveform recording active' : 'Audio waveform idle'}
    >
      {displayBars.map((heightPct, idx) => {
        const barHeight = Math.max(4, Math.floor(heightPct * 48));
        return (
          <View
            key={idx}
            style={[
              styles.bar,
              {
                height: barHeight,
                backgroundColor: isRecording ? theme.waveformBar : theme.border,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 64,
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  bar: {
    width: 3,
    marginHorizontal: 2,
    borderRadius: 2,
  },
});
