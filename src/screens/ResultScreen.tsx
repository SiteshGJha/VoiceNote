import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Share,
  Alert,
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
          <Text style={[styles.rawToggleText, { color: theme.danger, marginVertical: 20 }]}>
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

  const [currentTone, setCurrentTone] = useState<Tone>(result.tone);
  const [displayText, setDisplayText] = useState<string>(result.final);
  const [isShowingRaw, setIsShowingRaw] = useState<boolean>(false);
  const [isReRewriting, setIsReRewriting] = useState<boolean>(false);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  // Handle instant re-rewrite when user changes tone pill without re-recording
  const handleToneChange = async (newTone: Tone): Promise<void> => {
    if (newTone === currentTone || isReRewriting) return;

    setCurrentTone(newTone);
    setIsReRewriting(true);
    haptics.trigger('impactLight');

    try {
      const slmResult = await rewrite(result.raw, newTone, { lang: result.lang });
      InteractionManager.runAfterInteractions(() => {
        if (slmResult.status === 'ok') {
          setDisplayText(slmResult.final);
          setIsShowingRaw(false);
        } else {
          setDisplayText(slmResult.fallbackText);
        }
      });
    } catch (err) {
      logger.error('ResultScreen', 'Failed to re-rewrite tone', err);
    } finally {
      setIsReRewriting(false);
    }
  };

  const handleToggleRaw = (): void => {
    haptics.trigger('impactLight');
    if (isShowingRaw) {
      setIsShowingRaw(false);
      // Restore rewritten text
      setDisplayText(result.final);
    } else {
      setIsShowingRaw(true);
      setDisplayText(result.raw);
    }
  };

  const handleCopy = async (): Promise<void> => {
    haptics.trigger('success');
    try {
      if (Clipboard && typeof Clipboard.setString === 'function') {
        Clipboard.setString(displayText);
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
        message: displayText,
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
          disabled={isReRewriting}
        />

        {/* Action / Mode row */}
        <View style={styles.utilityRow}>
          <TouchableOpacity
            style={[
              styles.rawToggleChip,
              {
                backgroundColor: isShowingRaw ? theme.primaryLight : theme.surfaceSubtle,
                borderColor: isShowingRaw ? theme.primary : theme.border,
              },
            ]}
            onPress={handleToggleRaw}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isShowingRaw ? 'Viewing original raw transcript' : 'Viewing rewritten text'}
          >
            <Text style={[styles.rawToggleText, { color: isShowingRaw ? theme.primary : theme.textSecondary }]}>
              {isShowingRaw ? '📝 Showing Raw' : '✨ Showing Rewritten'}
            </Text>
          </TouchableOpacity>

          {isReRewriting && (
            <Text style={[styles.reRewritingText, { color: theme.accent }]}>
              Rewriting...
            </Text>
          )}
        </View>

        {/* Editable note card */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TextInput
            style={[styles.textInput, { color: theme.textPrimary }]}
            value={displayText}
            onChangeText={setDisplayText}
            multiline
            placeholder="Note content..."
            placeholderTextColor={theme.textMuted}
            accessible={true}
            accessibilityLabel="Editable note content"
          />
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.primary }]}
            onPress={handleCopy}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Copy text to clipboard"
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
            accessibilityLabel="Share text via native sheet"
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
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  rawToggleChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  rawToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  reRewritingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 180,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  textInput: {
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
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
