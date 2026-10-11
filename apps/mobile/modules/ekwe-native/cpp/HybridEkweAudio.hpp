#pragma once

#include "EkweCallbackSlot.hpp"
#include "HybridEkweAudioSpec.hpp"
#include <memory>

namespace margelo::nitro::ekwe {

// Thin Nitro-facing adapter over ekwe::CallbackSlot, which holds the
// capture-thread handoff and is testable on the host without Nitro or JSI.
struct ArrayBufferTraits {
    using Packet = std::shared_ptr<ArrayBuffer>;
    // The one copy per packet, and it cannot be avoided: the bytes belong to the
    // capture frame, but the ArrayBuffer outlives the dispatch call because JS
    // receives it asynchronously.
    static Packet make(const uint8_t* data, size_t size) { return ArrayBuffer::copy(data, size); }
};

class HybridEkweAudio : public HybridEkweAudioSpec {
public:
    HybridEkweAudio();
    ~HybridEkweAudio() override;

    // Methods
    double getAmplitude() override;

    // Properties
    std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> getOnOpusPacket() override;
    void setOnOpusPacket(const std::function<void(const std::shared_ptr<ArrayBuffer>&, double)>& onOpusPacket) override;

    std::function<void()> getOnVadSilence() override;
    void setOnVadSilence(const std::function<void()>& onVadSilence) override;

    // Static dispatch (called from capture threads)
    static void dispatchOpusPacket(const uint8_t* data, size_t size, float rms);
    static void dispatchVadSilence();

private:
    using Slot = ::ekwe::CallbackSlot<ArrayBufferTraits>;

    // Shared so the static registry can hold a strong reference: a capture
    // thread that has already loaded the slot must not have it freed underneath.
    std::shared_ptr<Slot> _slot;
};

} // namespace margelo::nitro::ekwe
