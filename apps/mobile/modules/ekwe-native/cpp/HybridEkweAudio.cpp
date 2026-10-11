#include "HybridEkweAudio.hpp"
#include <NitroModules/ArrayBuffer.hpp>

namespace ekwe {
    float get_current_rms();
}

namespace margelo::nitro::ekwe {

// Dispatch runs on the capture queue (iOS) or the AudioRecord worker (Android),
// never the JS thread. Nitro already moves the JS invocation onto the JS thread
// via its CallInvoker-backed Dispatcher — a void-returning callback is wrapped in
// an AsyncJSCallback, so calling it here only enqueues onto that Dispatcher.
// What still runs here is the snapshot load and the copy, and neither may wait
// on the JS thread.

HybridEkweAudio::HybridEkweAudio() : HybridObject(TAG), _slot(std::make_shared<Slot>()) {
    Slot::setActive(_slot);
}

HybridEkweAudio::~HybridEkweAudio() {
    if (Slot::active() == _slot) {
        Slot::setActive(nullptr);
    }
}

double HybridEkweAudio::getAmplitude() {
    return static_cast<double>(::ekwe::get_current_rms());
}

std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> HybridEkweAudio::getOnOpusPacket() {
    auto snapshot = _slot->get();
    if (!snapshot || !snapshot->onPacket) return {};
    return snapshot->onPacket;
}

void HybridEkweAudio::setOnOpusPacket(const std::function<void(const std::shared_ptr<ArrayBuffer>&, double)>& onOpusPacket) {
    _slot->setPacketCallback(onOpusPacket);
}

std::function<void()> HybridEkweAudio::getOnVadSilence() {
    auto snapshot = _slot->get();
    return snapshot ? snapshot->onEvent : std::function<void()>();
}

void HybridEkweAudio::setOnVadSilence(const std::function<void()>& onVadSilence) {
    _slot->setEventCallback(onVadSilence);
}

void HybridEkweAudio::dispatchOpusPacket(const uint8_t* data, size_t size, float rms) {
    Slot::dispatchPacket(data, size, static_cast<double>(rms));
}

void HybridEkweAudio::dispatchVadSilence() {
    Slot::dispatchEvent();
}

} // namespace margelo::nitro::ekwe
