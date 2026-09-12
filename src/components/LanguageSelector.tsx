import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Lang } from '@/ml/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface LanguageSelectorProps {
  selectedLang: Lang;
  onSelectLang: (lang: Lang) => void;
  disabled?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  selectedLang,
  onSelectLang,
  disabled = false,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const languages: { id: Lang; label: string }[] = [
    { id: 'auto', label: 'Auto (Detect)' },
    { id: 'en', label: 'English' },
    { id: 'hi', label: 'Hindi (हिंदी)' },
  ];

  return (
    <View style={styles.container}>
      {languages.map((l) => {
        const isSelected = selectedLang === l.id;
        return (
          <TouchableOpacity
            key={l.id}
            style={[
              styles.chip,
              {
                backgroundColor: isSelected ? theme.primaryLight : theme.surfaceSubtle,
                borderColor: isSelected ? theme.primary : theme.border,
              },
            ]}
            onPress={() => onSelectLang(l.id)}
            disabled={disabled}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`${l.label} language selector`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text
              style={[
                styles.chipText,
                { color: isSelected ? theme.primary : theme.textSecondary },
                isSelected && styles.chipTextSelected,
              ]}
            >
              {l.label}
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
    justifyContent: 'center',
    gap: 8,
    marginVertical: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextSelected: {
    fontWeight: '700',
  },
});
