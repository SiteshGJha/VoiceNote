import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Share,
  InteractionManager,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/routes';
import { Header } from '@/components/Header';
import { ToneSelector } from '@/components/ToneSelector';
import { rewrite } from '@/ml/slm';
import { Tone } from '@/ml/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';
import { logger } from '@/utils/logger';

type ResultScreenRouteProp = RouteProp<RootStackParamList, 'Result'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Result'>;

export const ResultScreen: React.FC = () => {
  const route = useRoute<ResultScreenRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const { result } = route.params;

  if (result.status === 'error') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <Header title="Error" onBack={() => navigation.navigate('Home')} />
        <View style={styles.content}>
          <Text style={[styles.sectionTitle, { color: theme.danger, marginVertical: 20 }]}>
            {result.message}
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.primary }]}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.actionButtonText}>Return to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const rawText = result.raw;
  const expectedToneRef = useRef<Tone>(result.tone);
  const [currentTone, setCurrentTone] = useState<Tone>(result.tone);
  const [rewrittenText, setRewrittenText] = useState<string>(result.final);
  const [isFallback, setIsFallback] = useState<boolean>(result.usedFallback);
  const [isReRewriting, setIsReRewriting] = useState<boolean>(false);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  // Keep the RAW and REWRITTEN transcripts visible simultaneously so the user
  // always sees exactly what was captured vs what was transformed.

  // Handle instant re-rewrite when user changes tone pill without re-recording
  const handleToneChange = async (newTone: Tone): Promise<void> => {
    if (newTone === expectedToneRef.current) return;

    expectedToneRef.current = newTone;
    setCurrentTone(newTone);
    setIsReRewriting(true);
    haptics.trigger('impactLight');

    try {
      const slmResult = await rewrite(result.raw, newTone, { lang: result.lang });
      if (expectedToneRef.current !== newTone) return;

      InteractionManager.runAfterInteractions(() => {
        if (expectedToneRef.current !== newTone) return;

        if (slmResult.status === 'ok') {
          setRewrittenText(slmResult.final);
          setIsFallback(false);
        } else {
          setRewrittenText(slmResult.fallbackText);
          setIsFallback(true);
        }
      });
    } catch (err) {
      if (expectedToneRef.current === newTone) {
        logger.error('ResultScreen', 'Failed to re-rewrite tone', err);
      }
    } finally {
      if (expectedToneRef.current === newTone) {
        setIsReRewriting(false);
      }
    }
  };

  const handleCopy = async (text: string): Promise<void> => {
    haptics.trigger('success');
    try {
      if (Clipboard && typeof Clipboard.setString === 'function') {
        Clipboard.setString(text);
      }
    } catch {
      // In web/fallback
    }

    setCopiedToast(true);
    const timer = setTimeout(() => setCopiedToast(false), 2000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  };

  const handleShare = async (): Promise<void> => {
    haptics.trigger('impactLight');
    try {
      await Share.share({
        message: rewrittenText,
        title: 'VoiceNote Export',
      });
    } catch (err) {
      logger.error('ResultScreen', 'Share failed', err);
    }
  };

  const handleReRecord = (): void => {
    haptics.trigger('impactLight');
    navigation.navigate('Home');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header
        title="Your Note"
        subtitle={`${result.lang.toUpperCase()} • ${Math.round(result.audioDurationMs / 1000)}s audio`}
        onBack={() => navigation.navigate('Home')}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Tone switch bar */}
        <ToneSelector
          selectedTone={currentTone}
          onSelectTone={handleToneChange}
        />

        {isReRewriting && (
          <Text style={[styles.reRewritingText, { color: theme.accent }]}>Rewriting...</Text>
        )}

        {/* RAW transcript: exactly what speech-to-text captured */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, { color: theme.textMuted }]}>AS SPOKEN</Text>
            <Text style={[styles.rawChip, { backgroundColor: theme.surfaceSubtle, color: theme.textSecondary }]}>
              Raw transcript
            </Text>
          </View>
          <Text style={[styles.rawText, { color: theme.textPrimary }]}>
            {rawText}
          </Text>
        </View>

        {/* REWRITTEN transcript: tone-transformed content */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, { color: theme.accent }]}>
              REWRITTEN • {currentTone.toUpperCase()}
            </Text>
            {isFallback ? (
              <Text style={[styles.fallbackChip, { backgroundColor: theme.warningLight, color: theme.warning }]}>
                Raw used
              </Text>
            ) : (
              <Text style={[styles.rawChip, { backgroundColor: theme.primaryLight, color: theme.primary }]}>
                ✨ Transformed
              </Text>
            )}
          </View>
          <TextInput
            style={[styles.textInput, { color: theme.textPrimary }]}
            value={rewrittenText}
            onChangeText={setRewrittenText}
            multiline
            placeholder="Rewritten content..."
            placeholderTextColor={theme.textMuted}
            accessible={true}
            accessibilityLabel="Editable rewritten note content"
          />
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.primary }]}
            onPress={() => handleCopy(rewrittenText)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Copy rewritten text to clipboard"
          >
            <Text style={styles.actionButtonText}>
              {copiedToast ? '✓ Copied!' : '📋 Copy'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.accent }]}
            onPress={handleShare}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Share rewritten text via native sheet"
          >
            <Text style={styles.actionButtonText}>📤 Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, borderWidth: 1 }]}
            onPress={handleReRecord}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Record another note"
          >
            <Text style={[styles.actionButtonText, { color: theme.textSecondary }]}>🎙 New</Text>
          </TouchableOpacity>
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
  reRewritingText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rawChip: {
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  fallbackChip: {
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  rawText: {
    fontSize: 15,
    lineHeight: 22,
  },
  textInput: {
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});