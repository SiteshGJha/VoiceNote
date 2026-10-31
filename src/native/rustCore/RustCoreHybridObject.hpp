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
  void loadHybridMethods() override;

private:
  void* vadHandle_ = nullptr;
};
} // namespace voicenote
