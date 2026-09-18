import { create } from 'zustand';
import { PipelineResult, Tone, Lang } from '@/ml/types';
import { MlErrorCode } from '@/ml/errors';

export type PipelineStage =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'rewriting'
  | 'completed'
  | 'error';

export interface PipelineMetrics {
  asrDurationMs?: number | undefined;
  slmDurationMs?: number | undefined;
  totalDurationMs?: number | undefined;
}

interface AppStore {
  stage: PipelineStage;
  activeTone: Tone;
  activeLanguage: Lang;
  lastResult: PipelineResult | null;
  lastErrorCode: MlErrorCode | null;
  errorMessage: string | null;
  metrics: PipelineMetrics | null;

  setStage: (stage: PipelineStage) => void;
  setActiveTone: (tone: Tone) => void;
  setActiveLanguage: (lang: Lang) => void;
  setLastResult: (result: PipelineResult | null) => void;
  setMetrics: (metrics: PipelineMetrics | null) => void;
  setError: (code: MlErrorCode, message: string) => void;
  clearError: () => void;
  resetPipeline: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  stage: 'idle',
  activeTone: 'professional',
  activeLanguage: 'auto',
  lastResult: null,
  lastErrorCode: null,
  errorMessage: null,
  metrics: null,

  setStage: (stage: PipelineStage) => set({ stage }),
  setActiveTone: (activeTone: Tone) => set({ activeTone }),
  setActiveLanguage: (activeLanguage: Lang) => set({ activeLanguage }),
  setLastResult: (lastResult: PipelineResult | null) => set({ lastResult, stage: 'completed' }),
  setMetrics: (metrics: PipelineMetrics | null) => set({ metrics }),
  setError: (lastErrorCode: MlErrorCode, errorMessage: string) =>
    set({ stage: 'error', lastErrorCode, errorMessage }),
  clearError: () => set({ lastErrorCode: null, errorMessage: null, stage: 'idle' }),
  resetPipeline: () =>
    set({
      stage: 'idle',
      lastResult: null,
      lastErrorCode: null,
      errorMessage: null,
      metrics: null,
    }),
}));
