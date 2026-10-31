#pragma once
#include <NitroModules/HybridObject.hpp>
#include <string>
#include "voicenote_core.h"

namespace voicenote {
class RustCoreHybridObject : public margelo::nitro::HybridObject {
public:
  RustCoreHybridObject() : HybridObject("RustCore") {}
  std::string getVersion();
  void loadHybridMethods() override;
};
} // namespace voicenote
