export type MlErrorCode =
  | 'ASR_EMPTY_OUTPUT'
  | 'ASR_TIMEOUT'
  | 'ASR_MODEL_MISSING'
  | 'SLM_TIMEOUT'
  | 'SLM_HALLUCINATION_SUSPECTED'
  | 'MODEL_CHECKSUM_FAILED'
  | 'STORAGE_FULL'
  | 'AUDIO_RECORD_FAILED'
  | 'VAD_NO_SPEECH'
  | 'SEGMENT_MERGE_FAILED'
  | 'RECORDING_LIMIT_REACHED'
  | 'HARDWARE_TRIGGER_DENIED';

export class MlError extends Error {
  public readonly code: MlErrorCode;
  public readonly details?: unknown;

  constructor(code: MlErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'MlError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, MlError.prototype);
  }

  public toJSON(): { name: string; code: MlErrorCode; message: string; details?: unknown } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function getUserFacingErrorMessage(code: MlErrorCode): string {
  switch (code) {
    case 'ASR_EMPTY_OUTPUT':
      return "Didn't catch that — please try speaking again.";
    case 'ASR_TIMEOUT':
      return 'Transcription took too long. Please try a shorter recording.';
    case 'ASR_MODEL_MISSING':
      return 'ASR model is not installed. Please download it from the Models screen.';
    case 'SLM_TIMEOUT':
      return 'Rewriting timed out — showing raw transcription.';
    case 'SLM_HALLUCINATION_SUSPECTED':
      return 'Rewriter output may have modified facts — fell back to raw transcription.';
    case 'MODEL_CHECKSUM_FAILED':
      return 'Downloaded model integrity check failed. Please re-download.';
    case 'STORAGE_FULL':
      return 'Device storage is nearly full. Please free space and try again.';
    case 'AUDIO_RECORD_FAILED':
      return 'Audio recording failed. Please check microphone permissions.';
    case 'VAD_NO_SPEECH':
      return 'No speech detected in recording.';
    case 'SEGMENT_MERGE_FAILED':
      return 'Could not seamlessly merge audio segments — saved with segment markers.';
    case 'RECORDING_LIMIT_REACHED':
      return 'Maximum recording limit reached (30 minutes). Audio has been processed.';
    case 'HARDWARE_TRIGGER_DENIED':
      return 'Hardware button listener could not be registered.';
    default:
      return 'An unexpected error occurred.';
  }
}
