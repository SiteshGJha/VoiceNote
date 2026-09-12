import React, { useEffect, useState } from 'react';
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

  const [bars, setBars] = useState<number[]>(() => new Array(barCount).fill(0.1));

  useEffect(() => {
    if (!isRecording) {
      setBars(new Array(barCount).fill(0.1));
      return;
    }

    setBars((prev) => {
      const next = [...prev.slice(1)];
      // Add slight organic jitter based on current amplitude
      const jitter = (Math.random() - 0.5) * 0.15;
      const height = Math.min(1.0, Math.max(0.1, amplitude + jitter));
      next.push(height);
      return next;
    });
  }, [amplitude, isRecording, barCount]);

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={isRecording ? 'Audio waveform recording active' : 'Audio waveform idle'}
    >
      {bars.map((heightPct, idx) => {
        const barHeight = Math.max(4, heightPct * 48);
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
