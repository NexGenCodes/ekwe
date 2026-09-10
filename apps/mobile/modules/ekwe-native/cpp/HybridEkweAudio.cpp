#include "HybridEkweAudio.hpp"
#include <NitroModules/ArrayBuffer.hpp>

namespace ekwe {
    float get_current_rms();
}

namespace margelo::nitro::ekwe {

HybridEkweAudio* HybridEkweAudio::g_instance = nullptr;
std::mutex HybridEkweAudio::g_instanceMutex;

HybridEkweAudio::HybridEkweAudio() : HybridObject(TAG) {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    g_instance = this;
}

HybridEkweAudio::~HybridEkweAudio() {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    if (g_instance == this) {
        g_instance = nullptr;
    }
}

double HybridEkweAudio::getAmplitude() {
    return static_cast<double>(::ekwe::get_current_rms());
}

std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> HybridEkweAudio::getOnOpusPacket() {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    return _onOpusPacket;
}

void HybridEkweAudio::setOnOpusPacket(const std::function<void(const std::shared_ptr<ArrayBuffer>&, double)>& onOpusPacket) {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    _onOpusPacket = onOpusPacket;
}

std::function<void()> HybridEkweAudio::getOnVadSilence() {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    return _onVadSilence;
}

void HybridEkweAudio::setOnVadSilence(const std::function<void()>& onVadSilence) {
    std::lock_guard<std::mutex> lock(g_instanceMutex);
    _onVadSilence = onVadSilence;
}

void HybridEkweAudio::dispatchOpusPacket(const uint8_t* data, size_t size, float rms) {
    std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> callback;
    {
        std::lock_guard<std::mutex> lock(g_instanceMutex);
        if (!g_instance || !g_instance->_onOpusPacket) return;
        callback = g_instance->_onOpusPacket;
    }
    auto buffer = ArrayBuffer::copy(data, size);
    callback(buffer, static_cast<double>(rms));
}

void HybridEkweAudio::dispatchVadSilence() {
    std::function<void()> callback;
    {
        std::lock_guard<std::mutex> lock(g_instanceMutex);
        if (!g_instance || !g_instance->_onVadSilence) return;
        callback = g_instance->_onVadSilence;
    }
    callback();
}

} // namespace margelo::nitro::ekwe
