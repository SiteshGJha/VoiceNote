#include "RustCoreHybridObject.hpp"
#include <NitroModules/HybridObjectRegistry.hpp>
#include <NitroModules/Prototype.hpp>

namespace voicenote {
std::string RustCoreHybridObject::getVersion() {
  const char* ver = voicenote_core_version();
  std::string result(ver ? ver : "unknown");
  voicenote_core_version_free(const_cast<char*>(ver));
  return result;
}

void RustCoreHybridObject::loadHybridMethods() {
  HybridObject::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerHybridMethod("getVersion", &RustCoreHybridObject::getVersion);
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
