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

void RustCoreHybridObject::loadHybridMethods() {
  HybridObject::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerHybridMethod("getVersion", &RustCoreHybridObject::getVersion);
    prototype.registerHybridMethod("trimAndSaveWav", &RustCoreHybridObject::trimAndSaveWav);
    prototype.registerHybridMethod("evalVad", &RustCoreHybridObject::evalVad);
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
