import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet, Platform } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

interface PermissionGateProps {
  permissionGranted: boolean;
  onRequestPermission: () => void;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  permissionGranted,
  onRequestPermission,
}) => {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  if (permissionGranted) {
    return null;
  }

  const handleOpenSettings = async (): Promise<void> => {
    try {
      await Linking.openSettings();
    } catch {
      // Ignore setting open errors on platforms where unsupported
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
      accessible={true}
      accessibilityLabel="Microphone permission required"
    >
      <Text style={[styles.title, { color: theme.textPrimary }]}>
        Microphone Access Needed
      </Text>
      <Text style={[styles.description, { color: theme.textSecondary }]}>
        VoiceNote runs 100% on your device and requires microphone permission to capture and transcribe your notes.
        Your audio is processed strictly offline and never uploaded or stored.
      </Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primary }]}
          onPress={onRequestPermission}
          accessibilityRole="button"
          accessibilityLabel="Grant microphone permission"
        >
          <Text style={styles.primaryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: theme.border }]}
          onPress={handleOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Open system settings"
        >
          <Text style={[styles.secondaryButtonText, { color: theme.textSecondary }]}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 12,
  },
  primaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
