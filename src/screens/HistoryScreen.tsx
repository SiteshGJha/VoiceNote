import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Modal,
  Share,
  ActivityIndicator,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation } from '@react-navigation/native';
import { Header } from '@/components/Header';
import { historyStorage } from '@/services/history';
import { TranscriptionRecord } from '@/services/history/types';
import { useSystemTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';

export const HistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const theme = useSystemTheme();

  const isMountedRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const [records, setRecords] = useState<TranscriptionRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<TranscriptionRecord | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  const loadHistory = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const list = await historyStorage.listRecords();
      if (isMountedRef.current) {
        setRecords(list);
      }
    } catch {
      // Ignored
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
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
      // Ignored
    }
    setCopiedToast(true);
    const timer = setTimeout(() => setCopiedToast(false), 2000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  };

  useEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;
    loadHistory();
    return () => {
      isMounted = false;
      isMountedRef.current = false;
    };
  }, []);

  const handleDeleteItem = (id: string): void => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          haptics.trigger('impactMedium');
          await historyStorage.deleteRecord(id);
          setSelectedRecord(null);
          loadHistory();
        },
      },
    ]);
  };

  const handleClearAll = (): void => {
    if (records.length === 0) return;
    Alert.alert(
      'Clear All History',
      'This will delete all saved offline notes. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            haptics.trigger('warning');
            await historyStorage.clearAll();
            loadHistory();
          },
        },
      ]
    );
  };

  const handleShare = async (text: string): Promise<void> => {
    haptics.trigger('impactLight');
    try {
      await Share.share({ message: text });
    } catch {
      // Ignored
    }
  };

  const renderItem = ({ item }: { item: TranscriptionRecord }) => {
    const dateFormatted = new Date(item.timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <TouchableOpacity
        style={[styles.itemCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={() => setSelectedRecord(item)}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Note from ${dateFormatted}`}
      >
        <View style={styles.itemHeader}>
          <Text style={[styles.itemDate, { color: theme.textMuted }]}>{dateFormatted}</Text>
          <View style={styles.tagRow}>
            <View style={[styles.tag, { backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.tagText, { color: theme.textSecondary }]}>
                {item.tone === 'professional' ? '💼 Pro' : '☕ Casual'}
              </Text>
            </View>
            <View style={[styles.tag, { backgroundColor: theme.primaryLight }]}>
              <Text style={[styles.tagText, { color: theme.primary }]}>
                {item.lang.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <Text
          style={[styles.itemSnippet, { color: theme.textPrimary }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {item.finalText}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header
        title="History"
        subtitle={`${records.length} / 50 encrypted notes`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: '🗑',
          label: 'Clear all history',
          onPress: handleClearAll,
        }}
      />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            testID="history-loading"
            size="large"
            color={theme.primary}
          />
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            records.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyIcon, { color: theme.textMuted }]}>📝</Text>
              <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No Notes Yet</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                No notes yet — tap the mic to record your first note.
              </Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      <Modal visible={selectedRecord !== null} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Note Detail</Text>
              <TouchableOpacity onPress={() => setSelectedRecord(null)}>
                <Text style={[styles.closeButtonText, { color: theme.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedRecord && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Rewritten Text</Text>
                <Text style={[styles.detailText, { color: theme.textPrimary }]}>
                  {selectedRecord.finalText}
                </Text>

                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Raw Transcript</Text>
                <Text style={[styles.detailTextRaw, { color: theme.textSecondary }]}>
                  {selectedRecord.rawText}
                </Text>

                {copiedToast && (
                  <Text style={[styles.copiedNotice, { color: theme.primary }]}>
                    ✓ Copied to clipboard
                  </Text>
                )}

                <View style={styles.modalActionRow}>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: theme.primary }]}
                    onPress={() => handleCopy(selectedRecord.finalText)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Copy rewritten text"
                  >
                    <Text style={styles.modalButtonText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: theme.accent }]}
                    onPress={() => handleShare(selectedRecord.finalText)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Share note"
                  >
                    <Text style={styles.modalButtonText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: theme.dangerSurface }]}
                    onPress={() => handleDeleteItem(selectedRecord.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Delete note"
                  >
                    <Text style={[styles.modalButtonText, { color: theme.danger }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  itemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  itemSnippet: {
    fontSize: 14,
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButtonText: {
    fontSize: 20,
    padding: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
  },
  detailTextRaw: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  copiedNotice: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
});
