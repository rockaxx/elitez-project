#include <string>
#include <emscripten/emscripten.h>

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    const char* runSimulation(const char* name) {
        static std::string result;
        result = "Malware '" + std::string(name) + "' bol úspešne nasadený!";
        return result.c_str();
    }
}

// 🟢 Toto je kľúčové pre STANDALONE_WASM
int main() {
    return 0;
}
