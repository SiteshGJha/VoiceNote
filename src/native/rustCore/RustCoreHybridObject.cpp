#include "RustCoreHybridObject.hpp"
#include <NitroModules/HybridObjectRegistry.hpp>
#include <NitroModules/Prototype.hpp>
#include <NitroModules/JSIConverter.hpp>

namespace margelo::nitro {
template <>
struct JSIConverter<voicenote::TrimAndSaveResult> final {
  static inline voicenote::TrimAndSaveResult fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    jsi::Object obj = arg.asObject(runtime);
    return voicenote::TrimAndSaveResult {
      obj.getProperty(runtime, "hasSpeech").asBool(),
      obj.getProperty(runtime, "status").asNumber()
    };
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const voicenote::TrimAndSaveResult& result) {
    jsi::Object obj(runtime);
    obj.setProperty(runtime, "hasSpeech", jsi::Value(result.hasSpeech));
    obj.setProperty(runtime, "status", jsi::Value(result.status));
    return obj;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject()) return false;
    jsi::Object obj = value.getObject(runtime);
    return obj.hasProperty(runtime, "hasSpeech") && obj.hasProperty(runtime, "status");
  }
};

template <>
struct JSIConverter<voicenote::VadEvalResult> final {
  static inline voicenote::VadEvalResult fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    jsi::Object obj = arg.asObject(runtime);
    return voicenote::VadEvalResult {
      obj.getProperty(runtime, "isSpeech").asBool(),
      obj.getProperty(runtime, "probability").asNumber()
    };
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const voicenote::VadEvalResult& result) {
    jsi::Object obj(runtime);
    obj.setProperty(runtime, "isSpeech", jsi::Value(result.isSpeech));
    obj.setProperty(runtime, "probability", jsi::Value(result.probability));
    return obj;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject()) return false;
    jsi::Object obj = value.getObject(runtime);
    return obj.hasProperty(runtime, "isSpeech") && obj.hasProperty(runtime, "probability");
  }
};

template <>
struct JSIConverter<voicenote::AsrNativeResult> final {
  static inline voicenote::AsrNativeResult fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    jsi::Object obj = arg.asObject(runtime);
    return voicenote::AsrNativeResult {
      obj.getProperty(runtime, "text").asString(runtime).utf8(runtime),
      obj.getProperty(runtime, "detectedLang").asString(runtime).utf8(runtime),
      obj.getProperty(runtime, "durationMs").asNumber()
    };
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const voicenote::AsrNativeResult& result) {
    jsi::Object obj(runtime);
    obj.setProperty(runtime, "text", jsi::String::createFromUtf8(runtime, result.text));
    obj.setProperty(runtime, "detectedLang", jsi::String::createFromUtf8(runtime, result.detectedLang));
    obj.setProperty(runtime, "durationMs", jsi::Value(result.durationMs));
    return obj;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject()) return false;
    jsi::Object obj = value.getObject(runtime);
    return obj.hasProperty(runtime, "text") && obj.hasProperty(runtime, "detectedLang") && obj.hasProperty(runtime, "durationMs");
  }
};

template <>
struct JSIConverter<voicenote::SlmNativeResult> final {
  static inline voicenote::SlmNativeResult fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    jsi::Object obj = arg.asObject(runtime);
    return voicenote::SlmNativeResult {
      obj.getProperty(runtime, "text").asString(runtime).utf8(runtime),
      obj.getProperty(runtime, "durationMs").asNumber()
    };
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const voicenote::SlmNativeResult& result) {
    jsi::Object obj(runtime);
    obj.setProperty(runtime, "text", jsi::String::createFromUtf8(runtime, result.text));
    obj.setProperty(runtime, "durationMs", jsi::Value(result.durationMs));
    return obj;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject()) return false;
    jsi::Object obj = value.getObject(runtime);
    return obj.hasProperty(runtime, "text") && obj.hasProperty(runtime, "durationMs");
  }
};
} // namespace margelo::nitro

namespace voicenote {

RustCoreHybridObject::RustCoreHybridObject() : HybridObject("RustCore") {
  vadHandle_ = vn_vad_create(2); // default Medium
}

RustCoreHybridObject::~RustCoreHybridObject() {
  if (vadHandle_) {
    vn_vad_free(vadHandle_);
    vadHandle_ = nullptr;
  }
}

std::string RustCoreHybridObject::getVersion() {
  const char* ver = voicenote_core_version();
  std::string result(ver ? ver : "unknown");
  voicenote_core_version_free(const_cast<char*>(ver));
  return result;
}

TrimAndSaveResult RustCoreHybridObject::trimAndSaveWav(
  const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
  const std::string& outputPath,
  std::optional<double> paddingMs
) {
  if (!pcm || pcm->size() == 0) {
    int32_t status = vn_audio_trim_and_save_wav(nullptr, 0, outputPath.c_str(), 0);
    return TrimAndSaveResult { false, static_cast<double>(status) };
  }

  const int16_t* pcm_ptr = reinterpret_cast<const int16_t*>(pcm->data());
  uintptr_t sample_count = pcm->size() / sizeof(int16_t);
  uint32_t padding = (paddingMs.has_value() && paddingMs.value() > 0)
                     ? static_cast<uint32_t>(paddingMs.value())
                     : 0;

  int32_t status = vn_audio_trim_and_save_wav(
    pcm_ptr,
    sample_count,
    outputPath.c_str(),
    padding
  );

  bool hasSpeech = (status == 1);
  return TrimAndSaveResult { hasSpeech, static_cast<double>(status) };
}

VadEvalResult RustCoreHybridObject::evalVad(
  const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
  std::optional<double> sensitivityMode
) {
  if (!pcm || pcm->size() == 0) {
    return VadEvalResult { false, 0.0 };
  }

  const int16_t* pcm_ptr = reinterpret_cast<const int16_t*>(pcm->data());
  uintptr_t sample_count = pcm->size() / sizeof(int16_t);
  uint8_t mode = (sensitivityMode.has_value() && sensitivityMode.value() > 0)
                 ? static_cast<uint8_t>(sensitivityMode.value())
                 : 2;

  float prob = vn_vad_eval_pcm_chunk(vadHandle_, pcm_ptr, sample_count, mode);

  double threshold = 0.5;
  if (mode == 1) threshold = 0.6;
  else if (mode == 3) threshold = 0.4;

  bool isSpeech = prob >= threshold;
  return VadEvalResult { isSpeech, static_cast<double>(prob) };
}

AsrNativeResult RustCoreHybridObject::transcribe(
  const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
  const std::string& modelPath,
  std::optional<std::string> language,
  std::optional<std::string> prompt,
  std::optional<double> timeoutMs
) {
  const int16_t* pcm_ptr = (pcm && pcm->size() > 0) ? reinterpret_cast<const int16_t*>(pcm->data()) : nullptr;
  uintptr_t sample_count = (pcm && pcm->size() > 0) ? (pcm->size() / sizeof(int16_t)) : 0;
  const char* lang_cstr = (language.has_value() && !language.value().empty()) ? language.value().c_str() : nullptr;
  const char* prompt_cstr = (prompt.has_value() && !prompt.value().empty()) ? prompt.value().c_str() : nullptr;
  uint64_t timeout = (timeoutMs.has_value() && timeoutMs.value() > 0) ? static_cast<uint64_t>(timeoutMs.value()) : 30000;

  VnAsrResponse* resp = vn_asr_transcribe(
    pcm_ptr,
    sample_count,
    modelPath.c_str(),
    lang_cstr,
    prompt_cstr,
    timeout
  );

  if (!resp) {
    throw std::runtime_error("UNKNOWN: vn_asr_transcribe returned null");
  }

  int32_t status = resp->status;
  if (status < 0) {
    int32_t code = -status;
    std::string errCodeStr = "UNKNOWN";
    switch (code) {
      case AsrEmptyOutput: errCodeStr = "ASR_EMPTY_OUTPUT"; break;
      case AsrTimeout: errCodeStr = "ASR_TIMEOUT"; break;
      case AsrModelMissing: errCodeStr = "ASR_MODEL_MISSING"; break;
      case SlmTimeout: errCodeStr = "SLM_TIMEOUT"; break;
      case SlmHallucinationSuspected: errCodeStr = "SLM_HALLUCINATION_SUSPECTED"; break;
      case ModelChecksumFailed: errCodeStr = "MODEL_CHECKSUM_FAILED"; break;
      case AudioRecordFailed: errCodeStr = "AUDIO_RECORD_FAILED"; break;
      case VadNoSpeech: errCodeStr = "VAD_NO_SPEECH"; break;
      case SegmentMergeFailed: errCodeStr = "SEGMENT_MERGE_FAILED"; break;
      case RecordingLimitReached: errCodeStr = "RECORDING_LIMIT_REACHED"; break;
      case HardwareTriggerDenied: errCodeStr = "HARDWARE_TRIGGER_DENIED"; break;
      case StorageFull: errCodeStr = "STORAGE_FULL"; break;
      default: errCodeStr = "UNKNOWN"; break;
    }
    vn_asr_response_free(resp);
    throw std::runtime_error(errCodeStr);
  }

  std::string text = resp->text ? resp->text : "";
  std::string detectedLang = resp->detected_lang ? resp->detected_lang : "en";
  double duration = static_cast<double>(resp->duration_ms);

  vn_asr_response_free(resp);

  return AsrNativeResult { text, detectedLang, duration };
}

SlmNativeResult RustCoreHybridObject::generate(
  const std::string& prompt,
  const std::string& modelPath,
  std::optional<double> temperature,
  std::optional<double> topP,
  std::optional<double> maxTokens,
  std::optional<double> timeoutMs
) {
  float temp = (temperature.has_value() && temperature.value() >= 0) ? static_cast<float>(temperature.value()) : 0.7f;
  float p = (topP.has_value() && topP.value() >= 0) ? static_cast<float>(topP.value()) : 0.9f;
  uint32_t tokens = (maxTokens.has_value() && maxTokens.value() > 0) ? static_cast<uint32_t>(maxTokens.value()) : 512;
  uint64_t timeout = (timeoutMs.has_value() && timeoutMs.value() > 0) ? static_cast<uint64_t>(timeoutMs.value()) : 10000;

  VnSlmResponse* resp = vn_slm_generate(
    prompt.c_str(),
    modelPath.c_str(),
    temp,
    p,
    tokens,
    timeout
  );

  if (!resp) {
    throw std::runtime_error("UNKNOWN: vn_slm_generate returned null");
  }

  int32_t status = resp->status;
  if (status < 0) {
    int32_t code = -status;
    std::string errCodeStr = "UNKNOWN";
    switch (code) {
      case AsrEmptyOutput: errCodeStr = "ASR_EMPTY_OUTPUT"; break;
      case AsrTimeout: errCodeStr = "ASR_TIMEOUT"; break;
      case AsrModelMissing: errCodeStr = "ASR_MODEL_MISSING"; break;
      case SlmTimeout: errCodeStr = "SLM_TIMEOUT"; break;
      case SlmHallucinationSuspected: errCodeStr = "SLM_HALLUCINATION_SUSPECTED"; break;
      case ModelChecksumFailed: errCodeStr = "MODEL_CHECKSUM_FAILED"; break;
      case AudioRecordFailed: errCodeStr = "AUDIO_RECORD_FAILED"; break;
      case VadNoSpeech: errCodeStr = "VAD_NO_SPEECH"; break;
      case SegmentMergeFailed: errCodeStr = "SEGMENT_MERGE_FAILED"; break;
      case RecordingLimitReached: errCodeStr = "RECORDING_LIMIT_REACHED"; break;
      case HardwareTriggerDenied: errCodeStr = "HARDWARE_TRIGGER_DENIED"; break;
      case StorageFull: errCodeStr = "STORAGE_FULL"; break;
      default: errCodeStr = "UNKNOWN"; break;
    }
    vn_slm_response_free(resp);
    throw std::runtime_error(errCodeStr);
  }

  std::string text = resp->text ? resp->text : "";
  double duration = static_cast<double>(resp->duration_ms);

  vn_slm_response_free(resp);

  return SlmNativeResult { text, duration };
}

bool RustCoreHybridObject::verifyFileSha256(const std::string& filePath, const std::string& expectedHex) {
  int32_t status = vn_crypto_verify_sha256(filePath.c_str(), expectedHex.c_str());
  return status == 1;
}

void RustCoreHybridObject::loadHybridMethods() {
  HybridObject::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerHybridMethod("getVersion", &RustCoreHybridObject::getVersion);
    prototype.registerHybridMethod("trimAndSaveWav", &RustCoreHybridObject::trimAndSaveWav);
    prototype.registerHybridMethod("evalVad", &RustCoreHybridObject::evalVad);
    prototype.registerHybridMethod("transcribe", &RustCoreHybridObject::transcribe);
    prototype.registerHybridMethod("generate", &RustCoreHybridObject::generate);
    prototype.registerHybridMethod("verifyFileSha256", &RustCoreHybridObject::verifyFileSha256);
  });
}
} // namespace voicenote

// Self-register with Nitro Modules HybridObjectRegistry at runtime
static struct RustCoreRegistrar {
  RustCoreRegistrar() {
    margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor(
      "RustCore",
      []() -> std::shared_ptr<margelo::nitro::HybridObject> {
        return std::make_shared<voicenote::RustCoreHybridObject>();
      }
    );
  }
} s_rust_core_registrar;
