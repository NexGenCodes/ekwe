#include <jni.h>
#include <string>
#include <vector>
#include <utility>
#include <cstring>
#include <mutex>
#include <atomic>
#include <android/log.h>
#include <jsi/jsi.h>
#include "../cpp/EkweAudioDecoder.h"
#include "../cpp/EkweCaptureController.h"
#include "../cpp/HybridEkweAudio.hpp"

#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkweJNI", fmt, ##__VA_ARGS__)

static std::mutex g_capture_mutex;
static ekwe::CaptureController* g_capture = nullptr;
static std::atomic<float> g_current_rms{0.0f};

// Last captured waveform (60 bins), stored before deleting g_capture
static std::vector<float> g_last_waveform;

// Accessor for HybridEkweAudio — reads the platform's g_current_rms atomic
namespace ekwe {
    float get_current_rms() {
        return g_current_rms.load(std::memory_order_relaxed);
    }
}

static jobjectArray buildResultArray(JNIEnv* env, const ekwe::DecodeResult& result) {
    jclass objClass = env->FindClass("java/lang/Object");
    jobjectArray retArray = env->NewObjectArray(4, objClass, nullptr);

    jclass booleanClass = env->FindClass("java/lang/Boolean");
    jmethodID booleanValueOf = env->GetStaticMethodID(booleanClass, "valueOf", "(Z)Ljava/lang/Boolean;");
    jobject successObj = env->CallStaticObjectMethod(booleanClass, booleanValueOf, result.success ? JNI_TRUE : JNI_FALSE);
    env->SetObjectArrayElement(retArray, 0, successObj);

    jstring errorStr = env->NewStringUTF(result.success ? "" : result.error_message.c_str());
    env->SetObjectArrayElement(retArray, 1, errorStr);

    jclass integerClass = env->FindClass("java/lang/Integer");
    jmethodID integerValueOf = env->GetStaticMethodID(integerClass, "valueOf", "(I)Ljava/lang/Integer;");
    jobject durationObj = env->CallStaticObjectMethod(integerClass, integerValueOf, (jint)result.duration_ms);
    env->SetObjectArrayElement(retArray, 2, durationObj);

    jfloatArray floatArray = env->NewFloatArray(result.waveform.size());
    if (result.waveform.size() > 0) {
        env->SetFloatArrayRegion(floatArray, 0, result.waveform.size(), result.waveform.data());
    }
    env->SetObjectArrayElement(retArray, 3, floatArray);

    return retArray;
}

static jobjectArray buildErrorResult(JNIEnv* env, const char* message) {
    ekwe::DecodeResult err;
    err.success = false;
    err.error_message = message ? message : "";
    err.duration_ms = 0;
    return buildResultArray(env, err);
}

// ─── Capture callback: forwards C++ events → JS via Nitro ──────────────────────
static void captureCallback(const ekwe::CaptureEventData& event) {
    switch (event.event) {
        case ekwe::CaptureEvent::AUDIO_DATA: {
            // Nitro path — zero-copy ArrayBuffer dispatch
            if (!event.data.empty()) {
                margelo::nitro::ekwe::HybridEkweAudio::dispatchOpusPacket(
                    event.data.data(), event.data.size(), event.rms);
            }
            break;
        }
        case ekwe::CaptureEvent::VAD_SILENCE: {
            // Nitro path
            margelo::nitro::ekwe::HybridEkweAudio::dispatchVadSilence();
            break;
        }
        default:
            break;
    }
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_transcodeToOpusWithWaveformJNI(
    JNIEnv *env, jobject thiz, jstring inputPath, jstring outputPath, jlong maxAudioBytes, jint frameMs) {

    const char *input_c_str = env->GetStringUTFChars(inputPath, nullptr);
    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    if (!input_c_str || !output_c_str) {
        if (input_c_str) env->ReleaseStringUTFChars(inputPath, input_c_str);
        if (output_c_str) env->ReleaseStringUTFChars(outputPath, output_c_str);
        return buildErrorResult(env, "String allocation failed");
    }

    std::string input(input_c_str);
    std::string output(output_c_str);

    env->ReleaseStringUTFChars(inputPath, input_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    ekwe::DecodeResult result = ekwe::transcode_audio_to_opus(input, output,
        static_cast<size_t>(maxAudioBytes), static_cast<int>(frameMs));
    return buildResultArray(env, result);
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_encodePcmToOpusJNI(
    JNIEnv *env, jobject thiz,
    jshortArray pcmData, jint sampleRate, jint channels, jstring outputPath) {

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    if (!output_c_str) return buildErrorResult(env, "String allocation failed");
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize num_samples = env->GetArrayLength(pcmData);
    jshort *pcm_ptr = env->GetShortArrayElements(pcmData, nullptr);
    if (!pcm_ptr) return buildErrorResult(env, "Array allocation failed");

    ekwe::DecodeResult result = ekwe::encode_pcm_to_opus(
        reinterpret_cast<const int16_t*>(pcm_ptr),
        static_cast<size_t>(num_samples),
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        output
    );

    env->ReleaseShortArrayElements(pcmData, pcm_ptr, JNI_ABORT);

    return buildResultArray(env, result);
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_transcodeFromMemoryJNI(
    JNIEnv *env, jobject thiz, jbyteArray data, jstring outputPath, jlong maxAudioBytes) {

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    if (!output_c_str) return buildErrorResult(env, "String allocation failed");
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize data_size = env->GetArrayLength(data);
    jbyte* data_ptr = env->GetByteArrayElements(data, nullptr);
    if (!data_ptr) return buildErrorResult(env, "Array allocation failed");

    ekwe::DecodeResult result = ekwe::transcode_audio_to_opus_from_memory(
        reinterpret_cast<const uint8_t*>(data_ptr),
        static_cast<size_t>(data_size),
        output,
        static_cast<size_t>(maxAudioBytes)
    );

    env->ReleaseByteArrayElements(data, data_ptr, JNI_ABORT);

    return buildResultArray(env, result);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeInitCapture(
    JNIEnv *env, jobject thiz, jstring outputPath, jint sampleRate, jint channels, jboolean isLive) {

    try {
        ALOG("nativeInitCapture: sr=%d ch=%d live=%d", sampleRate, channels, isLive);

        const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
        if (!output_c_str) return JNI_FALSE;
        std::string output(output_c_str);
        env->ReleaseStringUTFChars(outputPath, output_c_str);

        ekwe::CaptureMode mode = isLive ? ekwe::CaptureMode::LIVE : ekwe::CaptureMode::FILE;

        ALOG("nativeInitCapture: creating CaptureController...");

        auto* cap = new ekwe::CaptureController(
            static_cast<uint32_t>(sampleRate),
            static_cast<uint16_t>(channels),
            output,
            mode,
            true
        );

        ALOG("nativeInitCapture: CaptureController created, ok=%d", cap && cap->is_ok());

        if (!cap || !cap->is_ok()) {
            ALOG("nativeInitCapture: controller not ok, cleaning up");
            delete cap;
            return JNI_FALSE;
        }

        cap->set_callback(captureCallback);
        {
            std::lock_guard<std::mutex> lock(g_capture_mutex);
            if (g_capture) delete g_capture;
            g_capture = cap;
            g_last_waveform.clear();
            g_current_rms.store(0.0f, std::memory_order_relaxed);
        }

        ALOG("nativeInitCapture: SUCCESS");
        return JNI_TRUE;
    } catch (const std::exception& e) {
        ALOG("nativeInitCapture EXCEPTION: %s", e.what());
        return JNI_FALSE;
    } catch (...) {
        ALOG("nativeInitCapture UNKNOWN EXCEPTION");
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeFeedPcm(
    JNIEnv *env, jobject thiz, jshortArray pcmData, jint numSamples) {

    try {
        jshort* pcm_ptr = env->GetShortArrayElements(pcmData, nullptr);
        if (!pcm_ptr) return JNI_FALSE;

        bool ok = false;
        {
            std::lock_guard<std::mutex> lock(g_capture_mutex);
            if (g_capture) {
                ok = g_capture->feed_pcm(
                    reinterpret_cast<const int16_t*>(pcm_ptr),
                    static_cast<size_t>(numSamples)
                );
                g_current_rms.store(g_capture->rms(), std::memory_order_relaxed);
            }
        }

        env->ReleaseShortArrayElements(pcmData, pcm_ptr, JNI_ABORT);

        return ok ? JNI_TRUE : JNI_FALSE;
    } catch (const std::exception& e) {
        ALOG("nativeFeedPcm EXCEPTION: %s", e.what());
        return JNI_FALSE;
    } catch (...) {
        ALOG("nativeFeedPcm UNKNOWN EXCEPTION");
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeStopCapture(
    JNIEnv *env, jobject thiz) {

    try {
        ALOG("nativeStopCapture");

        ekwe::CaptureController* capture = nullptr;
        {
            // Claim the controller under the lock, then release it: stop()
            // re-decodes the finished Ogg to derive the waveform, and holding
            // g_capture_mutex across that decode would block amplitude polling
            // and every other JNI call for the duration. Safe because
            // g_capture is nulled inside the lock, so no other thread can reach
            // the controller and this one owns it exclusively until delete.
            std::lock_guard<std::mutex> lock(g_capture_mutex);
            if (!g_capture) {
                ALOG("nativeStopCapture: no capture");
                return JNI_FALSE;
            }
            capture = g_capture;
            g_capture = nullptr;
        }

        capture->stop();
        std::vector<float> waveform = capture->waveform();
        delete capture;

        const size_t waveform_bins = waveform.size();
        {
            std::lock_guard<std::mutex> lock(g_capture_mutex);
            g_last_waveform = std::move(waveform);
            g_current_rms.store(0.0f, std::memory_order_relaxed);
        }

        ALOG("nativeStopCapture: SUCCESS (waveform=%zu)", waveform_bins);
        return JNI_TRUE;
    } catch (const std::exception& e) {
        ALOG("nativeStopCapture EXCEPTION: %s", e.what());
        return JNI_FALSE;
    } catch (...) {
        ALOG("nativeStopCapture UNKNOWN EXCEPTION");
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jfloat JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeGetAmplitude(
    JNIEnv *env, jobject thiz) {

    try {
        return g_current_rms.load(std::memory_order_relaxed);
    } catch (const std::exception& e) {
        ALOG("nativeGetAmplitude EXCEPTION: %s", e.what());
        return 0.0f;
    } catch (...) {
        ALOG("nativeGetAmplitude UNKNOWN EXCEPTION");
        return 0.0f;
    }
}

// ─── Trigger Nitro event from Kotlin (e.g. audio focus loss) ────────────
extern "C" JNIEXPORT void JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeDispatchVadSilence(
    JNIEnv *env, jobject thiz) {
    margelo::nitro::ekwe::HybridEkweAudio::dispatchVadSilence();
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeGetLastWaveform(
    JNIEnv *env, jobject thiz) {

    try {
        std::lock_guard<std::mutex> lock(g_capture_mutex);
        jfloatArray result = env->NewFloatArray(g_last_waveform.size());
        if (!result) {
            ALOG("nativeGetLastWaveform: NewFloatArray failed");
            return nullptr;
        }
        if (!g_last_waveform.empty()) {
            env->SetFloatArrayRegion(result, 0, g_last_waveform.size(), g_last_waveform.data());
        }
        g_last_waveform.clear();
        return result;
    } catch (const std::exception& e) {
        ALOG("nativeGetLastWaveform EXCEPTION: %s", e.what());
        return nullptr;
    } catch (...) {
        ALOG("nativeGetLastWaveform UNKNOWN EXCEPTION");
        return nullptr;
    }
}
