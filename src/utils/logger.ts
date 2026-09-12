type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tag: string;
  message: string;
  data?: unknown;
}

// In-memory ring buffer (up to 200 entries) kept strictly on-device for diagnostics
const MAX_LOG_BUFFER = 200;
const logRingBuffer: LogEntry[] = [];

function appendLog(level: LogLevel, tag: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    tag,
    message,
    ...(data !== undefined ? { data } : {}),
  };

  if (logRingBuffer.length >= MAX_LOG_BUFFER) {
    logRingBuffer.shift();
  }
  logRingBuffer.push(entry);

  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (isDev) {
    // Only emit during local development runtime, never in production release
    const formatted = `[${entry.timestamp}] [${level.toUpperCase()}] [${tag}] ${message}`;
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(formatted, data ?? '');
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(formatted, data ?? '');
    } else {
      // eslint-disable-next-line no-console
      console.info(formatted, data ?? '');
    }
  }
}

export const logger = {
  debug: (tag: string, message: string, data?: unknown): void => appendLog('debug', tag, message, data),
  info: (tag: string, message: string, data?: unknown): void => appendLog('info', tag, message, data),
  warn: (tag: string, message: string, data?: unknown): void => appendLog('warn', tag, message, data),
  error: (tag: string, message: string, data?: unknown): void => appendLog('error', tag, message, data),
  getRecentLogs: (): readonly LogEntry[] => Object.freeze([...logRingBuffer]),
  clearLogs: (): void => {
    logRingBuffer.length = 0;
  },
};
