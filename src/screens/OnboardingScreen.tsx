import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/routes';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useSystemTheme } from '@/utils/theme';
import { ToneSelector } from '@/components/ToneSelector';
import { LanguageSelector } from '@/components/LanguageSelector';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

export const OnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useSystemTheme();
  const setHasCompletedOnboarding = useSettingsStore((s) => s.setHasCompletedOnboarding);
  const defaultTone = useSettingsStore((s) => s.defaultTone);
  const setDefaultTone = useSettingsStore((s) => s.setDefaultTone);
  const defaultLanguage = useSettingsStore((s) => s.defaultLanguage);
  const setDefaultLanguage = useSettingsStore((s) => s.setDefaultLanguage);

  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      title: 'Welcome to VoiceNote',
      icon: '🎙',
      desc: 'High-performance speech-to-text with real-time tone rewriting. Completely on-device and private.',
      bullets: [
        '🔒 Zero Cloud Inference: Audio never leaves device',
        '⚡ Instant Whisper ASR & SLM rewriting',
        '🧹 Ephemeral Audio: Temp files strictly deleted',
      ],
    },
    {
      title: 'On-Device AI Models',
      icon: '🧠',
      desc: 'VoiceNote downloads models directly to your storage for 100% offline operation.',
      bullets: [
        '📦 Whisper Base/Tiny for multilingual transcription',
        '💬 Qwen2.5 GGUF quantized model for tone rewrite',
        '🌐 Fully offline once downloaded',
      ],
    },
    {
      title: 'Personalize Defaults',
      icon: '⚙️',
      desc: 'Choose your preferred starting tone and speech recognition language.',
      customControl: true,
    },
    {
      title: "You're All Set!",
      icon: '🚀',
      desc: 'Ready to capture notes effortlessly without data loss. Double-press volume or tap record to start.',
      bullets: [
        '📊 Weekly and monthly statistics automatically generated',
        '🔍 Search and filter your offline history anytime',
      ],
    },
  ];

  const handleFinish = () => {
    setHasCompletedOnboarding(true);
    navigation.replace('Home');
  };

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      handleFinish();
    }
  };

  const slide = slides[currentSlide]!;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top bar with Skip button */}
      <View style={styles.topBar}>
        <Text style={[styles.stepIndicator, { color: theme.textMuted }]}>
          Step {currentSlide + 1} of {slides.length}
        </Text>
        {currentSlide < slides.length - 1 && (
          <TouchableOpacity onPress={handleFinish} accessible={true} accessibilityRole="button">
            <Text style={[styles.skipText, { color: theme.primary }]}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heroIcon}>{slide.icon}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{slide.title}</Text>
        <Text style={[styles.desc, { color: theme.textSecondary }]}>{slide.desc}</Text>

        {slide.bullets && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {slide.bullets.map((b, idx) => (
              <Text key={idx} style={[styles.bulletItem, { color: theme.textPrimary }]}>
                {b}
              </Text>
            ))}
          </View>
        )}

        {slide.customControl && (
          <View style={styles.controlsSection}>
            <Text style={[styles.controlLabel, { color: theme.textMuted }]}>DEFAULT TONE</Text>
            <ToneSelector selectedTone={defaultTone} onSelectTone={setDefaultTone} />

            <View style={{ height: 16 }} />

            <Text style={[styles.controlLabel, { color: theme.textMuted }]}>DEFAULT LANGUAGE</Text>
            <LanguageSelector selectedLang={defaultLanguage} onSelectLang={setDefaultLanguage} />
          </View>
        )}
      </ScrollView>

      {/* Footer navigation */}
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <View style={styles.dots}>
          {slides.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.dot,
                {
                  backgroundColor: idx === currentSlide ? theme.primary : theme.border,
                  width: idx === currentSlide ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, { backgroundColor: theme.primary }]}
          onPress={handleNext}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={currentSlide === slides.length - 1 ? 'Get Started' : 'Next Step'}
        >
          <Text style={styles.nextButtonText}>
            {currentSlide === slides.length - 1 ? 'Get Started 🚀' : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  stepIndicator: {
    fontSize: 13,
    fontWeight: '600',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
  },
  heroIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  desc: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    width: '100%',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  bulletItem: {
    fontSize: 14,
    lineHeight: 20,
  },
  controlsSection: {
    width: '100%',
  },
  controlLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderTopWidth: 1,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
