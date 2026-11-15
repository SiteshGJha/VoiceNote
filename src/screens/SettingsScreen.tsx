import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/routes';
import { Header } from '@/components/Header';
import { useSettingsStore } from '@/state/useSettingsStore';
import { historyStorage } from '@/services/history';
import { Tone, Lang, HindiOutputFormat, AsrModelTier } from '@/ml/types';
import { VadSensitivity } from '@/audio/vadPresets';
import { ThemeMode } from '@/state/types';
import { useSystemTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const settings = useSettingsStore();
  const theme = useSystemTheme();

  const handleWipeAllData = (): void => {
    Alert.alert(
      'Master Data Wipe',
      'This will permanently delete all saved history, reset all settings, and clean cached resources. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Everything',
          style: 'destructive',
          onPress: async () => {
            haptics.trigger('warning');
            await historyStorage.clearAll();
            settings.resetAllSettings();
            Alert.alert('Data Wiped', 'All notes and local data have been completely deleted.');
          },
        },
      ]
    );
  };

  const renderOptionRow = <T extends string>(
    title: string,
    currentValue: T,
    options: { label: string; value: T }[],
    onSelect: (val: T) => void
  ) => {
    return (
      <View style={[styles.settingBlock, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>{title}</Text>
        <View style={styles.optionButtonGroup}>
          {options.map((opt) => {
            const isSelected = opt.value === currentValue;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.optionButton,
                  isSelected && {
                    backgroundColor: theme.primaryLight,
                    borderColor: theme.primary,
                  },
                  !isSelected && {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => onSelect(opt.value)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`${opt.label} option for ${title}`}
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    { color: isSelected ? theme.primary : theme.textSecondary },
                    isSelected && styles.optionButtonTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Default Tone */}
        {renderOptionRow<Tone>(
          'Default Rewriting Tone',
          settings.defaultTone,
          [
            { label: '💼 Professional', value: 'professional' },
            { label: '☕ Casual', value: 'casual' },
          ],
          settings.setDefaultTone
        )}

        {/* Default Language */}
        {renderOptionRow<Lang>(
          'Default Language',
          settings.defaultLanguage,
          [
            { label: 'Auto Detect', value: 'auto' },
            { label: 'English', value: 'en' },
            { label: 'Hindi', value: 'hi' },
          ],
          settings.setDefaultLanguage
        )}

        {/* VAD Sensitivity */}
        {renderOptionRow<VadSensitivity>(
          'Voice Activity Sensitivity (VAD)',
          settings.vadSensitivity,
          [
            { label: 'Low (Noisy)', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High (Quiet)', value: 'high' },
          ],
          settings.setVadSensitivity
        )}

        {/* ASR Model Tier */}
        {renderOptionRow<AsrModelTier>(
          'Speech Recognition Model Tier',
          settings.asrModelTier,
          [
            { label: 'Fast (Tiny)', value: 'fast' },
            { label: 'Balanced (Base)', value: 'balanced' },
            { label: 'Accurate (Small)', value: 'accurate' },
          ],
          settings.setAsrModelTier
        )}

        {/* Hindi Output Format */}
        {renderOptionRow<HindiOutputFormat>(
          'Hindi Output Format',
          settings.hindiOutputFormat,
          [
            { label: 'Devanagari (हिंदी)', value: 'devanagari' },
            { label: 'Romanized (English letters)', value: 'romanized' },
          ],
          settings.setHindiOutputFormat
        )}

        {/* Theme Mode */}
        {renderOptionRow<ThemeMode>(
          'Appearance',
          settings.themeMode,
          [
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ],
          settings.setThemeMode
        )}

        {/* Hardware Double-Press Trigger */}
        {renderOptionRow<'volume' | 'headphone' | 'none'>(
          'Hardware Double-Press Trigger',
          settings.hardwareTriggerButton,
          [
            { label: '🔊 Volume', value: 'volume' },
            { label: '🎧 Headset', value: 'headphone' },
            { label: 'Off', value: 'none' },
          ],
          settings.setHardwareTriggerButton
        )}

        {/* Haptics Switch */}
        <View
          style={[styles.switchRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.switchLabel, { color: theme.textPrimary }]}>Haptic Feedback</Text>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={settings.setHapticsEnabled}
            trackColor={{ false: theme.surfaceSubtle, true: theme.primary }}
          />
        </View>

        {/* Auto-copy to Clipboard Switch */}
        <View
          style={[styles.switchRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.switchLabel, { color: theme.textPrimary }]}>Auto-copy to Clipboard</Text>
            <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
              Automatically copy tone-rewritten notes to clipboard ready to paste
            </Text>
          </View>
          <Switch
            value={settings.autoCopyToClipboard}
            onValueChange={settings.setAutoCopyToClipboard}
            trackColor={{ false: theme.surfaceSubtle, true: theme.primary }}
          />
        </View>

        {/* Privacy & Guarantees Link */}
        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => navigation.navigate('Privacy')}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Open Privacy & Security guarantees"
        >
          <Text style={[styles.menuItemText, { color: theme.textPrimary }]}>
            🛡️ Privacy & Zero-Cloud Guarantees
          </Text>
          <Text style={[styles.menuItemChevron, { color: theme.textMuted }]}>›</Text>
        </TouchableOpacity>

        {/* Master Delete All Data */}
        <TouchableOpacity
          style={[styles.dangerButton, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
          onPress={handleWipeAllData}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Delete all data"
        >
          <Text style={[styles.dangerButtonText, { color: theme.danger }]}>
            🗑 Delete All Data (Master Reset)
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  settingBlock: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  optionButtonGroup: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  optionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  optionButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  optionButtonTextSelected: {
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuItemChevron: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  dangerButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
