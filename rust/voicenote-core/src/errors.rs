#[repr(i32)]
#[derive(Debug, thiserror::Error, Clone, Copy, PartialEq, Eq)]
pub enum VnErrorCode {
    #[error("ASR returned empty transcript")]
    AsrEmptyOutput = 101,
    #[error("ASR transcription timed out")]
    AsrTimeout = 102,
    #[error("ASR model is missing")]
    AsrModelMissing = 103,
    #[error("SLM rewrite timed out")]
    SlmTimeout = 201,
    #[error("SLM hallucination suspected")]
    SlmHallucinationSuspected = 202,
    #[error("Model checksum verification failed")]
    ModelChecksumFailed = 301,
    #[error("Audio record failed")]
    AudioRecordFailed = 401,
    #[error("No speech detected in audio stream")]
    VadNoSpeech = 501,
    #[error("Segment merge failed")]
    SegmentMergeFailed = 601,
    #[error("Recording duration limit reached")]
    RecordingLimitReached = 602,
    #[error("Hardware button trigger access denied")]
    HardwareTriggerDenied = 603,
    #[error("Device storage full")]
    StorageFull = 701,
    #[error("Unknown error")]
    Unknown = 999,
}

impl VnErrorCode {
    pub fn as_i32(self) -> i32 {
        self as i32
    }

    pub fn from_i32(val: i32) -> Self {
        match val {
            101 => Self::AsrEmptyOutput,
            102 => Self::AsrTimeout,
            103 => Self::AsrModelMissing,
            201 => Self::SlmTimeout,
            202 => Self::SlmHallucinationSuspected,
            301 => Self::ModelChecksumFailed,
            401 => Self::AudioRecordFailed,
            501 => Self::VadNoSpeech,
            601 => Self::SegmentMergeFailed,
            602 => Self::RecordingLimitReached,
            603 => Self::HardwareTriggerDenied,
            701 => Self::StorageFull,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum VnError {
    #[error("ASR returned empty transcript")]
    AsrEmptyOutput,
    #[error("ASR transcription timed out")]
    AsrTimeout,
    #[error("ASR model is missing: {0}")]
    AsrModelMissing(String),
    #[error("SLM rewrite timed out")]
    SlmTimeout,
    #[error("SLM hallucination suspected: {0}")]
    SlmHallucinationSuspected(String),
    #[error("Model checksum verification failed: {0}")]
    ModelChecksumFailed(String),
    #[error("Audio record failed: {0}")]
    AudioRecordFailed(String),
    #[error("No speech detected in audio stream")]
    VadNoSpeech,
    #[error("Segment merge failed: {0}")]
    SegmentMergeFailed(String),
    #[error("Recording duration limit reached")]
    RecordingLimitReached,
    #[error("Hardware button trigger access denied: {0}")]
    HardwareTriggerDenied(String),
    #[error("Device storage full")]
    StorageFull,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl VnError {
    pub fn code(&self) -> VnErrorCode {
        match self {
            VnError::AsrEmptyOutput => VnErrorCode::AsrEmptyOutput,
            VnError::AsrTimeout => VnErrorCode::AsrTimeout,
            VnError::AsrModelMissing(_) => VnErrorCode::AsrModelMissing,
            VnError::SlmTimeout => VnErrorCode::SlmTimeout,
            VnError::SlmHallucinationSuspected(_) => VnErrorCode::SlmHallucinationSuspected,
            VnError::ModelChecksumFailed(_) => VnErrorCode::ModelChecksumFailed,
            VnError::AudioRecordFailed(_) => VnErrorCode::AudioRecordFailed,
            VnError::VadNoSpeech => VnErrorCode::VadNoSpeech,
            VnError::SegmentMergeFailed(_) => VnErrorCode::SegmentMergeFailed,
            VnError::RecordingLimitReached => VnErrorCode::RecordingLimitReached,
            VnError::HardwareTriggerDenied(_) => VnErrorCode::HardwareTriggerDenied,
            VnError::StorageFull => VnErrorCode::StorageFull,
            VnError::Io(_) => VnErrorCode::Unknown,
            VnError::Unknown(_) => VnErrorCode::Unknown,
        }
    }
}

impl From<VnErrorCode> for VnError {
    fn from(code: VnErrorCode) -> Self {
        match code {
            VnErrorCode::AsrEmptyOutput => VnError::AsrEmptyOutput,
            VnErrorCode::AsrTimeout => VnError::AsrTimeout,
            VnErrorCode::AsrModelMissing => VnError::AsrModelMissing(String::new()),
            VnErrorCode::SlmTimeout => VnError::SlmTimeout,
            VnErrorCode::SlmHallucinationSuspected => {
                VnError::SlmHallucinationSuspected(String::new())
            }
            VnErrorCode::ModelChecksumFailed => VnError::ModelChecksumFailed(String::new()),
            VnErrorCode::AudioRecordFailed => VnError::AudioRecordFailed(String::new()),
            VnErrorCode::VadNoSpeech => VnError::VadNoSpeech,
            VnErrorCode::SegmentMergeFailed => VnError::SegmentMergeFailed(String::new()),
            VnErrorCode::RecordingLimitReached => VnError::RecordingLimitReached,
            VnErrorCode::HardwareTriggerDenied => VnError::HardwareTriggerDenied(String::new()),
            VnErrorCode::StorageFull => VnError::StorageFull,
            VnErrorCode::Unknown => VnError::Unknown(String::new()),
        }
    }
}
