#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include <mutex>
#include <android/log.h>
#include <jsi/jsi.h>
#include "../cpp/EkweAudioDecoder.h"
#include "../cpp/EkweCaptureController.h"

#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkweJNI", fmt, ##__VA_ARGS__)

static std::mutex g_capture_mutex;
static ekwe::CaptureController* g_capture = nullptr;
static JavaVM* g_jvm = nullptr;

static jmethodID g_emitOpusPacket = nullptr;
static jmethodID g_emitVadSilence = nullptr;

static jclass g_moduleClass = nullptr;

// Last captured waveform (60 bins), stored before deleting g_capture
static std::vector<float> g_last_waveform;

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

// ─── Capture callback: forwards C++ events → Kotlin ──────────────────────
static void captureCallback(const ekwe::CaptureEventData& event) {
    if (!g_jvm) return;

    JNIEnv* env = nullptr;
    bool needDetach = false;

    jint getEnvRes = g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (getEnvRes == JNI_EDETACHED) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        needDetach = true;
    } else if (getEnvRes != JNI_OK) {
        return;
    }

    switch (event.event) {
        case ekwe::CaptureEvent::AUDIO_DATA: {
            if (g_emitOpusPacket && !event.data.empty()) {
                jbyteArray byteArray = env->NewByteArray(event.data.size());
                if (byteArray) {
                    env->SetByteArrayRegion(byteArray, 0, event.data.size(),
                        reinterpret_cast<const jbyte*>(event.data.data()));
                    env->CallStaticVoidMethod(
                        g_moduleClass, g_emitOpusPacket, byteArray, (jfloat)event.rms);
                    if (env->ExceptionCheck()) env->ExceptionClear();
                    env->DeleteLocalRef(byteArray);
                }
            }
            break;
        }
        case ekwe::CaptureEvent::VAD_SILENCE: {
            if (g_emitVadSilence) {
                env->CallStaticVoidMethod(g_moduleClass, g_emitVadSilence);
                if (env->ExceptionCheck()) env->ExceptionClear();
            }
            break;
        }
        default:
            break;
    }

    if (needDetach) {
        g_jvm->DetachCurrentThread();
    }
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_transcodeToOpusWithWaveformJNI(
    JNIEnv *env, jobject thiz, jstring inputPath, jstring outputPath, jlong maxAudioBytes) {

    const char *input_c_str = env->GetStringUTFChars(inputPath, nullptr);
    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);

    std::string input(input_c_str);
    std::string output(output_c_str);

    env->ReleaseStringUTFChars(inputPath, input_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    ekwe::DecodeResult result = ekwe::transcode_audio_to_opus(input, output,
        static_cast<size_t>(maxAudioBytes));
    return buildResultArray(env, result);
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_encodePcmToOpusJNI(
    JNIEnv *env, jobject thiz,
    jshortArray pcmData, jint sampleRate, jint channels, jstring outputPath) {

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize num_samples = env->GetArrayLength(pcmData);
    jshort *pcm_ptr = env->GetShortArrayElements(pcmData, nullptr);

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
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize data_size = env->GetArrayLength(data);
    jbyte* data_ptr = env->GetByteArrayElements(data, nullptr);

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

        if (!g_jvm) {
            env->GetJavaVM(&g_jvm);
        }

        if (!g_moduleClass) {
            jclass local = env->FindClass("expo/modules/ekwenative/EkweNativeModule");
            if (!local) return JNI_FALSE;
            g_moduleClass = static_cast<jclass>(env->NewGlobalRef(local));
            env->DeleteLocalRef(local);
        }

        if (env->ExceptionCheck()) env->ExceptionClear();
        if (!g_emitOpusPacket) {
            g_emitOpusPacket = env->GetStaticMethodID(
                g_moduleClass, "emitOpusPacketFromNative", "([BF)V");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                g_emitOpusPacket = nullptr;
            }
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
        if (!g_emitVadSilence) {
            g_emitVadSilence = env->GetStaticMethodID(
                g_moduleClass, "emitVadSilenceFromNative", "()V");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                g_emitVadSilence = nullptr;
            }
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
        const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
        std::string output(output_c_str);
        env->ReleaseStringUTFChars(outputPath, output_c_str);

        ekwe::CaptureMode mode = isLive ? ekwe::CaptureMode::LIVE : ekwe::CaptureMode::FILE;

        ALOG("nativeInitCapture: creating CaptureController...");

        auto* cap = new ekwe::CaptureController(
            static_cast<uint32_t>(sampleRate),
            static_cast<uint16_t>(channels),
            output,
            std::string(), // caf path — Android plays Ogg natively, no CAF
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
        std::lock_guard<std::mutex> lock(g_capture_mutex);
        if (!g_capture) {
            ALOG("nativeStopCapture: no capture");
            g_last_waveform.clear();
            return JNI_FALSE;
        }

        g_capture->stop();
        g_last_waveform = g_capture->get_waveform(60);
        delete g_capture;
        g_capture = nullptr;

        ALOG("nativeStopCapture: SUCCESS (waveform=%zu)", g_last_waveform.size());
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
        std::lock_guard<std::mutex> lock(g_capture_mutex);
        if (!g_capture) return 0.0f;
        return g_capture->rms();
    } catch (const std::exception& e) {
        ALOG("nativeGetAmplitude EXCEPTION: %s", e.what());
        return 0.0f;
    } catch (...) {
        ALOG("nativeGetAmplitude UNKNOWN EXCEPTION");
        return 0.0f;
    }
}

// ─── JSI: install ekweNativeGetAmplitude on JS runtime ──────────────────────
extern "C" JNIEXPORT void JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeInstallJsi(
    JNIEnv* env, jobject thiz, jlong jsContextPointer) {

    try {
        auto* runtime = reinterpret_cast<facebook::jsi::Runtime*>(
            static_cast<intptr_t>(jsContextPointer));
        if (!runtime) {
            ALOG("nativeInstallJsi: null runtime pointer");
            return;
        }

        auto hostFn = facebook::jsi::Function::createFromHostFunction(
            *runtime,
            facebook::jsi::PropNameID::forAscii(*runtime, "ekweNativeGetAmplitude"),
            0,
            [](facebook::jsi::Runtime& rt,
               const facebook::jsi::Value& thisVal,
               const facebook::jsi::Value* args,
               size_t count) -> facebook::jsi::Value {
                std::lock_guard<std::mutex> lock(g_capture_mutex);
                if (!g_capture) return facebook::jsi::Value(0.0);
                return facebook::jsi::Value(
                    static_cast<double>(g_capture->rms()));
            });

        runtime->global().setProperty(
            *runtime, "ekweNativeGetAmplitude", std::move(hostFn));

        ALOG("nativeInstallJsi: installed ekweNativeGetAmplitude");
    } catch (const std::exception& e) {
        ALOG("nativeInstallJsi EXCEPTION: %s", e.what());
    } catch (...) {
        ALOG("nativeInstallJsi UNKNOWN EXCEPTION");
    }
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
