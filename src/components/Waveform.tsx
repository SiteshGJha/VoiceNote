import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface WaveformProps {
  amplitude: number; // 0.0 to 1.0
  isRecording: boolean;
  barCount?: number;
}

export const Waveform: React.FC<WaveformProps> = ({
  amplitude,
  isRecording,
  barCount = 28,
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
    // 60ms throttle to prevent UI thread thrashing on long recordings
    if (now - lastUpdateMsRef.current < 60) {
      return;
    }
    lastUpdateMsRef.current = now;

    const prevHeight = barsRef.current[barsRef.current.length - 1] ?? 0.1;
    // Deterministic low-pass filter: smooth amplitude transitions without Math.random() jitter
    const height = Math.min(1.0, Math.max(0.1, prevHeight * 0.7 + amplitude * 0.3));
    const next = [...barsRef.current.slice(1), height];
    barsRef.current = next;
    setBars(next);
  }, [amplitude, isRecording, barCount, baselineBars]);

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
