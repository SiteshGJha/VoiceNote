import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface ProgressBarProps {
  progress?: number; // 0 to 100
  indeterminate?: boolean;
  label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress = 0,
  indeterminate = false,
  label,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <View style={styles.container}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={[styles.labelText, { color: theme.textSecondary }]}>{label}</Text>
          {!indeterminate && (
            <Text style={[styles.percentText, { color: theme.textMuted }]}>
              {Math.round(clampedProgress)}%
            </Text>
          )}
        </View>
      )}
      <View
        style={[styles.track, { backgroundColor: theme.surfaceSubtle }]}
        accessible={true}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: clampedProgress }}
      >
        <View
          style={[
            styles.fill,
            {
              backgroundColor: theme.primary,
              width: indeterminate ? '100%' : `${clampedProgress}%`,
              opacity: indeterminate ? 0.7 : 1,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  labelText: {
    fontSize: 12,
    fontWeight: '500',
  },
  percentText: {
    fontSize: 12,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});
