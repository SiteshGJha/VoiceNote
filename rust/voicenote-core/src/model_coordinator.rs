use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::errors::VnError;

/// Active on-device ML model subsystem.
/// Rule 02 constraint: Never hold two large models in memory simultaneously (< 500 MB RAM budget).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveModel {
    None,
    Whisper,
    Llama,
}

/// Internal state tracking active model and memory occupancy.
#[derive(Debug)]
pub struct ModelCoordinatorState {
    pub active_model: ActiveModel,
    pub active_path: Option<String>,
    pub last_activity: Instant,
    pub whisper_loaded: bool,
    pub llama_loaded: bool,
    pub total_swaps: u64,
}

impl Default for ModelCoordinatorState {
    fn default() -> Self {
        Self {
            active_model: ActiveModel::None,
            active_path: None,
            last_activity: Instant::now(),
            whisper_loaded: false,
            llama_loaded: false,
            total_swaps: 0,
        }
    }
}

/// Thread-safe coordinator ensuring mutual exclusion between Whisper and LLaMA.
#[derive(Clone, Debug)]
pub struct ModelCoordinator {
    state: Arc<Mutex<ModelCoordinatorState>>,
    idle_timeout: Duration,
}

static GLOBAL_COORDINATOR: OnceLock<ModelCoordinator> = OnceLock::new();

impl Default for ModelCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl ModelCoordinator {
    /// Default idle timeout is 60 seconds per Rule 02.
    pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

    /// Creates a new `ModelCoordinator` with the default 60s idle timeout.
    pub fn new() -> Self {
        Self::with_idle_timeout(Self::DEFAULT_IDLE_TIMEOUT)
    }

    /// Creates a new `ModelCoordinator` with a custom idle timeout.
    pub fn with_idle_timeout(idle_timeout: Duration) -> Self {
        Self {
            state: Arc::new(Mutex::new(ModelCoordinatorState::default())),
            idle_timeout,
        }
    }

    /// Accesses the global shared `ModelCoordinator` instance.
    pub fn global() -> &'static ModelCoordinator {
        GLOBAL_COORDINATOR.get_or_init(Self::new)
    }

    /// Requests exclusive activation of a model subsystem.
    /// If another model is active, it is immediately evicted/unloaded
    /// to stay strictly within the < 500 MB peak RAM envelope.
    pub async fn request_subsystem(
        &self,
        target: ActiveModel,
        model_path: Option<&str>,
    ) -> Result<(), VnError> {
        let mut state = self.state.lock().await;

        match target {
            ActiveModel::Whisper => {
                if state.llama_loaded {
                    // Evict LLaMA from memory
                    state.llama_loaded = false;
                    state.total_swaps += 1;
                }
                state.whisper_loaded = true;
                state.active_model = ActiveModel::Whisper;
                state.active_path = model_path.map(|s| s.to_string());
                state.last_activity = Instant::now();
            }
            ActiveModel::Llama => {
                if state.whisper_loaded {
                    // Evict Whisper from memory
                    state.whisper_loaded = false;
                    state.total_swaps += 1;
                }
                state.llama_loaded = true;
                state.active_model = ActiveModel::Llama;
                state.active_path = model_path.map(|s| s.to_string());
                state.last_activity = Instant::now();
            }
            ActiveModel::None => {
                state.whisper_loaded = false;
                state.llama_loaded = false;
                state.active_model = ActiveModel::None;
                state.active_path = None;
                state.last_activity = Instant::now();
            }
        }

        // Mutual exclusion invariant check
        assert!(
            !(state.whisper_loaded && state.llama_loaded),
            "FATAL: ModelCoordinator invariant violated! Both Whisper and LLaMA marked loaded."
        );

        Ok(())
    }

    /// Returns the currently active model subsystem.
    pub async fn active_subsystem(&self) -> ActiveModel {
        let state = self.state.lock().await;
        state.active_model
    }

    /// Returns whether the specified subsystem is currently active.
    pub async fn is_subsystem_active(&self, subsystem: ActiveModel) -> bool {
        let state = self.state.lock().await;
        state.active_model == subsystem
    }

    /// Records user or inference activity, resetting the idle timer.
    pub async fn record_activity(&self) {
        let mut state = self.state.lock().await;
        state.last_activity = Instant::now();
    }

    /// Checks if the active model has exceeded the idle timeout.
    /// If so, unloads the model to free memory and returns `true`.
    pub async fn check_idle_timeout(&self) -> bool {
        let mut state = self.state.lock().await;
        if state.active_model != ActiveModel::None && state.last_activity.elapsed() >= self.idle_timeout {
            state.active_model = ActiveModel::None;
            state.whisper_loaded = false;
            state.llama_loaded = false;
            state.active_path = None;
            return true;
        }
        false
    }

    /// Immediately unloads all models.
    pub async fn unload_all(&self) {
        let mut state = self.state.lock().await;
        state.active_model = ActiveModel::None;
        state.whisper_loaded = false;
        state.llama_loaded = false;
        state.active_path = None;
    }
}
