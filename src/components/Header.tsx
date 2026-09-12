import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: {
    icon: string;
    label: string;
    onPress: () => void;
  };
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightAction,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <View style={styles.leftContainer}>
        {onBack && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={[styles.backText, { color: theme.primary }]}>←</Text>
          </TouchableOpacity>
        )}
        <View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>
          )}
        </View>
      </View>

      {rightAction && (
        <TouchableOpacity
          style={styles.rightButton}
          onPress={rightAction.onPress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={rightAction.label}
        >
          <Text style={styles.rightIcon}>{rightAction.icon}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 6,
  },
  backText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  rightButton: {
    padding: 8,
  },
  rightIcon: {
    fontSize: 18,
  },
});
