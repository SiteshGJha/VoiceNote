import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Tone, Lang } from '@/ml/types';
import { useSystemTheme } from '@/utils/theme';

export type HistoryFilterType = 'all' | 'pro' | 'casual' | 'en' | 'hi';

interface HistoryFilterFABProps {
  activeFilter: HistoryFilterType;
  onSelectFilter: (filter: HistoryFilterType) => void;
}

export const HistoryFilterFAB: React.FC<HistoryFilterFABProps> = ({
  activeFilter,
  onSelectFilter,
}) => {
  const theme = useSystemTheme();
  const [isOpen, setIsOpen] = useState(false);

  const filters: Array<{ id: HistoryFilterType; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'pro', label: '💼 Pro' },
    { id: 'casual', label: '☕ Casual' },
    { id: 'en', label: 'EN' },
    { id: 'hi', label: 'HI' },
  ];

  return (
    <View style={styles.container}>
      {isOpen && (
        <View style={[styles.drawer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {filters.map((f) => {
              const active = activeFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? theme.primary : theme.surfaceSubtle,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                  onPress={() => {
                    onSelectFilter(f.id);
                    setIsOpen(false);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${f.label}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? '#FFFFFF' : theme.textPrimary },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        onPress={() => setIsOpen(!isOpen)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Toggle filter options"
      >
        <Text style={styles.fabIcon}>{isOpen ? '✕' : '⚡'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'flex-end',
  },
  drawer: {
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  fabIcon: {
    fontSize: 22,
    color: '#FFFFFF',
  },
});
