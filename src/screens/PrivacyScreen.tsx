import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Header } from '@/components/Header';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';

export const PrivacyScreen: React.FC = () => {
  const navigation = useNavigation();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const guarantees = [
    {
      title: 'Zero Cloud Inference',
      desc: 'All speech recognition (Whisper) and tone rewriting (GGUF SLM) execute strictly on your device CPU/NPU. No audio or text is ever sent over the internet.',
      icon: '🔒',
    },
    {
      title: 'Zero Audio Persistence',
      desc: 'Audio files are created in temporary cache during recording and strictly deleted immediately after transcription finishes, even if an error occurs.',
      icon: '🗑️',
    },
    {
      title: 'Zero Telemetry or Analytics',
      desc: 'VoiceNote contains zero tracking SDKs, zero crash reporters, zero analytics libraries, and zero ad identifiers.',
      icon: '🚫',
    },
    {
      title: 'Encrypted On-Device History',
      desc: 'Your past notes (capped at 50 with automatic FIFO eviction) are stored in encrypted MMKV backed by your operating system keychain.',
      icon: '🔐',
    },
    {
      title: 'Explicit Network Scope',
      desc: 'The only network activity permitted is downloading offline ML model weights via HTTPS with SHA-256 integrity verification initiated by you.',
      icon: '🌐',
    },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header title="Privacy & Security" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Text style={styles.heroBadge}>🛡️ 100% Offline</Text>
          <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>
            Your Voice Never Leaves Your Phone
          </Text>
          <Text style={[styles.heroDesc, { color: theme.textSecondary }]}>
            VoiceNote is engineered with absolute privacy as its core constraint. Here is how your data is protected.
          </Text>
        </View>

        <View style={styles.guaranteeList}>
          {guarantees.map((g, idx) => (
            <View
              key={idx}
              style={[styles.guaranteeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={styles.cardIcon}>{g.icon}</Text>
              <View style={styles.cardTextContainer}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{g.title}</Text>
                <Text style={[styles.cardDesc, { color: theme.textSecondary }]}>{g.desc}</Text>
              </View>
            </View>
          ))}
        </View>
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
  },
  heroCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  heroBadge: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  guaranteeList: {
    gap: 12,
  },
  guaranteeCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  cardIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
});
