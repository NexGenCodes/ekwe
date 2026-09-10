#pragma once

#include "HybridEkweAudioSpec.hpp"
#include <memory>
#include <mutex>

namespace margelo::nitro::ekwe {

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
    std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> _onOpusPacket;
    std::function<void()> _onVadSilence;

    static HybridEkweAudio* g_instance;
    static std::mutex g_instanceMutex;
};

} // namespace margelo::nitro::ekwe
