import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Tone } from '@/ml/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface ToneSelectorProps {
  selectedTone: Tone;
  onSelectTone: (tone: Tone) => void;
  disabled?: boolean;
}

export const ToneSelector: React.FC<ToneSelectorProps> = ({
  selectedTone,
  onSelectTone,
  disabled = false,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const tones: { id: Tone; label: string; icon: string }[] = [
    { id: 'professional', label: 'Professional', icon: '💼' },
    { id: 'casual', label: 'Casual', icon: '☕' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceSubtle }]}>
      {tones.map((t) => {
        const isSelected = selectedTone === t.id;
        return (
          <TouchableOpacity
            key={t.id}
            style={[
              styles.pill,
              isSelected && {
                backgroundColor: theme.surface,
                shadowColor: '#000000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.1,
                shadowRadius: 2,
                elevation: 2,
              },
            ]}
            onPress={() => onSelectTone(t.id)}
            disabled={disabled}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`${t.label} tone selector`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={styles.icon}>{t.icon}</Text>
            <Text
              style={[
                styles.label,
                { color: isSelected ? theme.primary : theme.textSecondary },
                isSelected && styles.labelSelected,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginVertical: 8,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  icon: {
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  labelSelected: {
    fontWeight: '700',
  },
});
