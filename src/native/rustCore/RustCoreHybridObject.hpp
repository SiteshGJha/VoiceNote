#pragma once
#include <NitroModules/HybridObject.hpp>
#include <NitroModules/ArrayBuffer.hpp>
#include <string>
#include <memory>
#include <optional>
#include "voicenote_core.h"

namespace voicenote {

struct TrimAndSaveResult {
  bool hasSpeech;
  double status;
};

struct VadEvalResult {
  bool isSpeech;
  double probability;
};

struct AsrNativeResult {
  std::string text;
  std::string detectedLang;
  double durationMs;
};

class RustCoreHybridObject : public margelo::nitro::HybridObject {
public:
  RustCoreHybridObject();
  ~RustCoreHybridObject() override;
  std::string getVersion();
  TrimAndSaveResult trimAndSaveWav(
    const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
    const std::string& outputPath,
    std::optional<double> paddingMs
  );
  VadEvalResult evalVad(
    const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
    std::optional<double> sensitivityMode
  );
  AsrNativeResult transcribe(
    const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
    const std::string& modelPath,
    std::optional<std::string> language,
    std::optional<std::string> prompt,
    std::optional<double> timeoutMs
  );
  void loadHybridMethods() override;

private:
  void* vadHandle_ = nullptr;
};
} // namespace voicenote
