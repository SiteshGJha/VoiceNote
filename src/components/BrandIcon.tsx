import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface BrandIconProps {
  size?: number;
}

export const BrandIcon: React.FC<BrandIconProps> = ({ size = 32 }) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primary },
      ]}
      accessible={true}
      accessibilityLabel="SJ"
    >
      <Text style={[styles.monogram, { fontSize: size * 0.4, color: '#FFFFFF' }]}>SJ</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogram: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});