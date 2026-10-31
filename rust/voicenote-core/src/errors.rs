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
            VnErrorCode::SlmHallucinationSuspected => VnError::SlmHallucinationSuspected(String::new()),
            VnErrorCode::ModelChecksumFailed => VnError::ModelChecksumFailed(String::new()),
            VnErrorCode::AudioRecordFailed => VnError::AudioRecordFailed(String::new()),
            VnErrorCode::Unknown => VnError::Unknown(String::new()),
        }
    }
}
