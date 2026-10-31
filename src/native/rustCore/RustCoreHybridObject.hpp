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

class RustCoreHybridObject : public margelo::nitro::HybridObject {
public:
  RustCoreHybridObject() : HybridObject("RustCore") {}
  std::string getVersion();
  TrimAndSaveResult trimAndSaveWav(
    const std::shared_ptr<margelo::nitro::ArrayBuffer>& pcm,
    const std::string& outputPath,
    std::optional<double> paddingMs
  );
  void loadHybridMethods() override;
};
} // namespace voicenote
