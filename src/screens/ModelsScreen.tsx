import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Header } from '@/components/Header';
import { ProgressBar } from '@/components/ProgressBar';
import { modelInstaller, ModelSpec } from '@/services/modelManager';
import { useSettingsStore } from '@/state/useSettingsStore';
import { lightTheme, darkTheme } from '@/utils/theme';
import { haptics } from '@/utils/haptics';

export const ModelsScreen: React.FC = () => {
  const navigation = useNavigation();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  const [availableModels, setAvailableModels] = useState<ModelSpec[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [totalStorageBytes, setTotalStorageBytes] = useState(0);

  const refreshModels = (): void => {
    setAvailableModels(modelInstaller.listAvailable());
    setTotalStorageBytes(modelInstaller.getTotalStorageUsageBytes());
  };

  useEffect(() => {
    refreshModels();
  }, []);

  const handleDownload = async (model: ModelSpec): Promise<void> => {
    if (downloadingId) return;

    haptics.trigger('impactLight');
    setDownloadingId(model.id);

    try {
      await modelInstaller.installModel(model.id, (percent) => {
        setDownloadProgress((prev) => ({ ...prev, [model.id]: percent }));
      });
      haptics.trigger('success');
      Alert.alert('Model Installed', `${model.displayName} is ready for offline use.`);
    } catch (err) {
      haptics.trigger('error');
      Alert.alert('Download Error', err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      refreshModels();
    }
  };

  const handleDelete = (model: ModelSpec): void => {
    Alert.alert(
      'Delete Model',
      `Are you sure you want to remove ${model.displayName}? You will need to re-download it to use offline transcription/rewriting.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            haptics.trigger('impactMedium');
            await modelInstaller.deleteModel(model.id);
            refreshModels();
          },
        },
      ]
    );
  };

  const formatSize = (bytes: number): string => {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const renderModelItem = ({ item }: { item: ModelSpec }) => {
    const isInstalled = modelInstaller.isInstalled(item.id);
    const isDownloading = downloadingId === item.id;
    const progress = downloadProgress[item.id] ?? 0;

    return (
      <View style={[styles.modelCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={[styles.modelName, { color: theme.textPrimary }]}>{item.displayName}</Text>
            <Text style={[styles.modelMeta, { color: theme.textMuted }]}>
              {item.kind.toUpperCase()} • {item.quant} • {formatSize(item.sizeBytes)} • min {item.minRamGb} GB RAM
            </Text>
          </View>
          {item.recommended && (
            <View style={[styles.recommendedBadge, { backgroundColor: theme.primaryLight }]}>
              <Text style={[styles.recommendedText, { color: theme.primary }]}>Default</Text>
            </View>
          )}
        </View>

        {isDownloading && (
          <ProgressBar progress={progress} label="Downloading model weights..." />
        )}

        <View style={styles.cardFooter}>
          <View style={styles.statusIndicator}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isInstalled ? theme.success : theme.textMuted },
              ]}
            />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>
              {isInstalled ? 'Installed (Offline)' : 'Available for download'}
            </Text>
          </View>

          {isInstalled ? (
            <TouchableOpacity
              style={[styles.deleteButton, { borderColor: theme.dangerSurface }]}
              onPress={() => handleDelete(item)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.displayName}`}
            >
              <Text style={[styles.deleteButtonText, { color: theme.danger }]}>Delete</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.downloadButton, { backgroundColor: theme.primary }]}
              onPress={() => handleDownload(item)}
              disabled={downloadingId !== null}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Download ${item.displayName}`}
            >
              <Text style={styles.downloadButtonText}>
                {isDownloading ? 'Downloading...' : 'Download'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header
        title="On-Device Models"
        subtitle="Manage offline ML models"
        onBack={() => navigation.goBack()}
      />

      {/* Storage usage summary banner */}
      <View style={[styles.storageBanner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <Text style={[styles.storageTitle, { color: theme.textPrimary }]}>Local Storage Used</Text>
        <Text style={[styles.storageValue, { color: theme.primary }]}>
          {formatSize(totalStorageBytes)}
        </Text>
        <Text style={[styles.storageNote, { color: theme.textMuted }]}>
          Models run 100% locally on your phone hardware with zero network calls during inference.
        </Text>
      </View>

      <FlatList
        data={availableModels}
        keyExtractor={(item) => item.id}
        renderItem={renderModelItem}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  storageBanner: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  storageTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  storageValue: {
    fontSize: 24,
    fontWeight: '800',
    marginVertical: 4,
  },
  storageNote: {
    fontSize: 12,
    lineHeight: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  modelCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '700',
  },
  modelMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  recommendedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recommendedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  downloadButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  deleteButtonText: {
    fontWeight: '600',
    fontSize: 13,
  },
});
