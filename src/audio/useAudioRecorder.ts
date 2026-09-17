import { useState, useEffect, useCallback, useRef } from 'react';
import { audioRecorder } from './recorder';
import { RecordedAudio, RecordingState, AudioMeteringData } from './types';
import { haptics } from '@/utils/haptics';

export interface UseAudioRecorderOptions {
  onFrame?: (chunk: Uint8Array, metering: AudioMeteringData) => void;
}

export interface UseAudioRecorderReturn {
  recordingState: RecordingState;
  durationMs: number;
  amplitude: number;
  start: () => Promise<void>;
  stop: () => Promise<RecordedAudio | null>;
  cancel: () => Promise<void>;
}

export function useAudioRecorder(options?: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const onFrameRef = useRef(options?.onFrame);
  onFrameRef.current = options?.onFrame;

  useEffect(() => {
    const unsubscribe = audioRecorder.addListener((chunk, metering) => {
      setAmplitude(metering.amplitude);
      onFrameRef.current?.(chunk, metering);
    });

    return () => {
      unsubscribe();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const start = useCallback(async () => {
    haptics.trigger('impactMedium');
    await audioRecorder.start();
    setRecordingState('recording');
    setDurationMs(0);

    const startTime = Date.now();
    const timer = setInterval(() => {
      setDurationMs(Date.now() - startTime);
    }, 100);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    intervalRef.current = timer;
  }, []);

  const stop = useCallback(async () => {
    haptics.trigger('impactLight');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRecordingState('processing');
    const result = await audioRecorder.stop();
    setRecordingState('idle');
    setAmplitude(0);
    return result;
  }, []);

  const cancel = useCallback(async () => {
    haptics.trigger('warning');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    await audioRecorder.cancel();
    setRecordingState('idle');
    setDurationMs(0);
    setAmplitude(0);
  }, []);

  return {
    recordingState,
    durationMs,
    amplitude,
    start,
    stop,
    cancel,
  };
}
