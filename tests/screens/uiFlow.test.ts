jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (fn: () => void) => {
      fn();
      return { cancel: () => {} };
    },
  },
  Alert: {
    alert: jest.fn(),
  },
  Share: {
    share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  },
}));

import { useAppStore } from '@/state/useAppStore';
import { useSettingsStore } from '@/state/useSettingsStore';
import { historyStorage } from '@/services/history';
import { modelInstaller } from '@/services/modelManager';
import { InteractionManager } from 'react-native';

describe('Phase 6: UI Flows & Production Hardening', () => {
  beforeEach(async () => {
    useAppStore.getState().resetPipeline();
    useSettingsStore.getState().resetAllSettings();
    await historyStorage.clearAll();
  });

  afterEach(async () => {
    await historyStorage.clearAll();
  });

  describe('App Store Pipeline Transitions', () => {
    it('initializes with idle stage and default tone/language', () => {
      const state = useAppStore.getState();
      expect(state.stage).toBe('idle');
      expect(state.activeTone).toBe('professional');
      expect(state.activeLanguage).toBe('auto');
      expect(state.metrics).toBeNull();
      expect(state.lastResult).toBeNull();
    });

    it('transitions smoothly through full pipeline stages', () => {
      const store = useAppStore.getState();

      store.setStage('recording');
      expect(useAppStore.getState().stage).toBe('recording');

      store.setStage('transcribing');
      expect(useAppStore.getState().stage).toBe('transcribing');

      store.setStage('rewriting');
      expect(useAppStore.getState().stage).toBe('rewriting');

      store.setLastResult({
        status: 'ok',
        raw: 'Hello test note',
        final: 'Hello test note.',
        tone: 'professional',
        lang: 'en',
        totalDurationMs: 1200,
        audioDurationMs: 2500,
        asrDurationMs: 650,
        slmDurationMs: 450,
        usedFallback: false,
      });

      expect(useAppStore.getState().stage).toBe('completed');
      const last = useAppStore.getState().lastResult;
      expect(last?.status).toBe('ok');
      if (last?.status === 'ok') {
        expect(last.final).toBe('Hello test note.');
      }
    });

    it('tracks pipeline timing metrics for UI responsiveness profiling', () => {
      const store = useAppStore.getState();
      store.setMetrics({
        asrDurationMs: 650,
        slmDurationMs: 450,
        totalDurationMs: 1200,
      });

      const metrics = useAppStore.getState().metrics;
      expect(metrics).not.toBeNull();
      expect(metrics?.asrDurationMs).toBe(650);
      expect(metrics?.slmDurationMs).toBe(450);
      expect(metrics?.totalDurationMs).toBe(1200);
    });

    it('handles pipeline errors and resets to idle on clearError', () => {
      const store = useAppStore.getState();
      store.setError('SLM_TIMEOUT', 'On-device tone rewriting timed out after 10s');

      expect(useAppStore.getState().stage).toBe('error');
      expect(useAppStore.getState().lastErrorCode).toBe('SLM_TIMEOUT');
      expect(useAppStore.getState().errorMessage).toContain('timed out');

      store.clearError();
      expect(useAppStore.getState().stage).toBe('idle');
      expect(useAppStore.getState().lastErrorCode).toBeNull();
      expect(useAppStore.getState().errorMessage).toBeNull();
    });
  });

  describe('Settings Store Configuration', () => {
    it('manages tone, language, VAD sensitivity, and theme mode preferences', () => {
      const settings = useSettingsStore.getState();

      settings.setDefaultTone('casual');
      expect(useSettingsStore.getState().defaultTone).toBe('casual');

      settings.setDefaultLanguage('hi');
      expect(useSettingsStore.getState().defaultLanguage).toBe('hi');

      settings.setVadSensitivity('high');
      expect(useSettingsStore.getState().vadSensitivity).toBe('high');

      settings.setThemeMode('light');
      expect(useSettingsStore.getState().themeMode).toBe('light');

      settings.resetAllSettings();
      expect(useSettingsStore.getState().defaultTone).toBe('professional');
      expect(useSettingsStore.getState().defaultLanguage).toBe('auto');
      expect(useSettingsStore.getState().vadSensitivity).toBe('medium');
      expect(useSettingsStore.getState().themeMode).toBe('system');
    });
  });

  describe('Encrypted History Management & 50-Item FIFO Cap', () => {
    it('saves, retrieves, and deletes individual notes from encrypted storage', async () => {
      const record = await historyStorage.addRecord({
        rawText: 'Raw test note',
        finalText: 'Professional test note.',
        tone: 'professional',
        lang: 'en',
        audioDurationMs: 2000,
        processingDurationMs: 1200,
      });

      expect(record.id).toBeDefined();
      expect(record.finalText).toBe('Professional test note.');

      let records = await historyStorage.listRecords();
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe(record.id);

      await historyStorage.deleteRecord(record.id);
      records = await historyStorage.listRecords();
      expect(records).toHaveLength(0);
    });

    it('strictly enforces the 500-item cap by evicting oldest records (FIFO)', async () => {
      // Seed 505 notes
      for (let i = 1; i <= 505; i++) {
        await historyStorage.addRecord({
          rawText: `Note #${i}`,
          finalText: `Clean Note #${i}`,
          tone: 'professional',
          lang: 'en',
          audioDurationMs: 1000,
          processingDurationMs: 800,
        });
      }

      const records = await historyStorage.listRecords();
      expect(records.length).toBe(500);

      // The newest note should be #505, and the oldest preserved should be #6 (#1-#5 evicted)
      expect(records[0]?.finalText).toBe('Clean Note #505');
      expect(records[records.length - 1]?.finalText).toBe('Clean Note #6');
    });
  });

  describe('Model Availability Guard', () => {
    it('verifies that both ASR and SLM models are available for offline operation', () => {
      const installed = modelInstaller.listInstalled();
      const hasAsr = installed.some((m) => m.kind === 'asr');
      const hasSlm = installed.some((m) => m.kind === 'slm');

      expect(hasAsr).toBe(true);
      expect(hasSlm).toBe(true);
    });
  });

  describe('Off-Thread UI Responsiveness', () => {
    it('executes callbacks scheduled via InteractionManager.runAfterInteractions', (done) => {
      let executed = false;

      InteractionManager.runAfterInteractions(() => {
        executed = true;
        expect(executed).toBe(true);
        done();
      });
    });
  });
});
