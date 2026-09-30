import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useSystemTheme } from '@/utils/theme';

interface HistorySearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
}

export const HistorySearchBar: React.FC<HistorySearchBarProps> = ({
  value,
  onChangeText,
  onClear,
}) => {
  const theme = useSystemTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.searchIcon, { color: theme.textMuted }]}>🔍</Text>
      <TextInput
        style={[styles.input, { color: theme.textPrimary }]}
        placeholder="Search notes..."
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={onClear}
          style={styles.clearButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text style={[styles.clearText, { color: theme.textMuted }]}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
