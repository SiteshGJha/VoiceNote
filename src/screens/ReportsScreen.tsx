import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Header } from '@/components/Header';
import { historyStorage } from '@/services/history';
import { computeStats, PeriodStats } from '@/services/statsEngine';
import { calculateBarLayout } from '@/utils/chartHelpers';
import { useSystemTheme } from '@/utils/theme';

export const ReportsScreen: React.FC = () => {
  const navigation = useNavigation();
  const theme = useSystemTheme();

  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [stats, setStats] = useState<PeriodStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadStats = async (selectedPeriod: 'week' | 'month' | 'year') => {
    setLoading(true);
    try {
      const records = await historyStorage.listRecords();
      InteractionManager.runAfterInteractions(() => {
        const computed = computeStats(records, selectedPeriod);
        setStats(computed);
        setLoading(false);
      });
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats(period);
  }, [period]);

  const barItems = stats ? calculateBarLayout(stats.dailyCounts) : [];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Header
        title="Reports"
        subtitle={stats?.label ?? 'Offline Usage Dashboard'}
        onBack={() => navigation.goBack()}
      />

      {/* Period Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        {(['week', 'month', 'year'] as const).map((p) => {
          const active = period === p;
          return (
            <TouchableOpacity
              key={p}
              style={[
                styles.tabButton,
                active && { borderBottomColor: theme.primary, borderBottomWidth: 3 },
              ]}
              onPress={() => setPeriod(p)}
              accessible={true}
              accessibilityRole="tab"
              accessibilityLabel={`${p} view`}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? theme.primary : theme.textMuted },
                  active && styles.tabTextActive,
                ]}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Summary Cards */}
          <View style={styles.metricsGrid}>
            <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>TOTAL WORDS</Text>
              <Text style={[styles.metricValue, { color: theme.primary }]}>
                {stats?.totalWords.toLocaleString() ?? '0'}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>TOTAL NOTES</Text>
              <Text style={[styles.metricValue, { color: theme.accent }]}>
                {stats?.totalNotes ?? 0}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>AVG WORDS/NOTE</Text>
              <Text style={[styles.metricValue, { color: theme.textPrimary }]}>
                {stats?.avgWordsPerNote ?? 0}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>MOST ACTIVE HOUR</Text>
              <Text style={[styles.metricValue, { color: theme.textPrimary }]}>
                {stats?.topHour !== null ? `${stats?.topHour}:00` : '--'}
              </Text>
            </View>
          </View>

          {/* Bar Chart Section */}
          <View style={[styles.chartCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Daily Word Generation</Text>
            <View style={styles.barChartContainer}>
              {barItems.map((bar) => (
                <View key={bar.key} style={styles.barColumn}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: `${bar.heightPercent}%`,
                          backgroundColor: bar.value > 0 ? theme.primary : theme.border,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barLabel, { color: theme.textMuted }]} numberOfLines={1}>
                    {bar.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Tone & Language Split */}
          <View style={[styles.chartCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Tone & Language Distribution</Text>

            <View style={styles.rowDistribution}>
              <View style={styles.halfCol}>
                <Text style={[styles.subLabel, { color: theme.textSecondary }]}>By Tone</Text>
                <Text style={[styles.rowText, { color: theme.textPrimary }]}>
                  💼 Pro: {stats?.byTone.professional ?? 0} words
                </Text>
                <Text style={[styles.rowText, { color: theme.textPrimary }]}>
                  ☕ Casual: {stats?.byTone.casual ?? 0} words
                </Text>
              </View>

              <View style={styles.halfCol}>
                <Text style={[styles.subLabel, { color: theme.textSecondary }]}>By Language</Text>
                <Text style={[styles.rowText, { color: theme.textPrimary }]}>
                  English: {stats?.byLang.en ?? 0} words
                </Text>
                <Text style={[styles.rowText, { color: theme.textPrimary }]}>
                  Hindi: {stats?.byLang.hi ?? 0} words
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: '48%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  chartCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  barChartContainer: {
    flexDirection: 'row',
    height: 120,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  barTrack: {
    flex: 1,
    width: 8,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    borderRadius: 4,
  },
  barLabel: {
    fontSize: 9,
    marginTop: 4,
  },
  rowDistribution: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfCol: {
    flex: 1,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  rowText: {
    fontSize: 13,
    marginBottom: 4,
  },
});
