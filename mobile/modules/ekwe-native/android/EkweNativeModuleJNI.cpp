#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include "../cpp/EkweAudioDecoder.h"

// ─── Global streaming FLAC encoder (singleton — one recording at a time) ──
static ekwe::FlacStreamEncoder* g_flac_encoder = nullptr;

// ─── Helper: jobjectArray builder ────────────────────────────────────────
// Builds an Object[4]: { Boolean success, String error, Integer duration, float[] waveform }
static jobjectArray buildResultArray(JNIEnv* env, const ekwe::DecodeResult& result) {
    jclass objClass = env->FindClass("java/lang/Object");
    jobjectArray retArray = env->NewObjectArray(4, objClass, nullptr);

    // 0: success
    jclass booleanClass = env->FindClass("java/lang/Boolean");
    jmethodID booleanValueOf = env->GetStaticMethodID(booleanClass, "valueOf", "(Z)Ljava/lang/Boolean;");
    jobject successObj = env->CallStaticObjectMethod(booleanClass, booleanValueOf, result.success ? JNI_TRUE : JNI_FALSE);
    env->SetObjectArrayElement(retArray, 0, successObj);

    // 1: error message or output path
    jstring errorStr = env->NewStringUTF(result.success ? "" : result.error_message.c_str());
    env->SetObjectArrayElement(retArray, 1, errorStr);

    // 2: duration
    jclass integerClass = env->FindClass("java/lang/Integer");
    jmethodID integerValueOf = env->GetStaticMethodID(integerClass, "valueOf", "(I)Ljava/lang/Integer;");
    jobject durationObj = env->CallStaticObjectMethod(integerClass, integerValueOf, (jint)result.duration_ms);
    env->SetObjectArrayElement(retArray, 2, durationObj);

    // 3: waveform
    jfloatArray floatArray = env->NewFloatArray(result.waveform.size());
    if (result.waveform.size() > 0) {
        env->SetFloatArrayRegion(floatArray, 0, result.waveform.size(), result.waveform.data());
    }
    env->SetObjectArrayElement(retArray, 3, floatArray);

    return retArray;
}

// ─── Existing: extractWavAndWaveformJNI ────────────────────────────────
extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_extractWavAndWaveformJNI(
    JNIEnv *env, jobject thiz, jstring inputPath, jstring outputPath) {

    const char *input_c_str = env->GetStringUTFChars(inputPath, nullptr);
    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);

    std::string input(input_c_str);
    std::string output(output_c_str);

    env->ReleaseStringUTFChars(inputPath, input_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    ekwe::DecodeResult result = ekwe::extract_audio_and_waveform(input, output);
    return buildResultArray(env, result);
}

// ─── Existing: encodePcmToFlacJNI ──────────────────────────────────────
extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_encodePcmToFlacJNI(
    JNIEnv *env, jobject thiz,
    jshortArray pcmData, jint sampleRate, jint channels, jstring outputPath) {

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize num_samples = env->GetArrayLength(pcmData);
    jshort *pcm_ptr = env->GetShortArrayElements(pcmData, nullptr);

    ekwe::DecodeResult result = ekwe::encode_pcm_to_flac(
        reinterpret_cast<const int16_t*>(pcm_ptr),
        static_cast<size_t>(num_samples),
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        output
    );

    env->ReleaseShortArrayElements(pcmData, pcm_ptr, JNI_ABORT);

    return buildResultArray(env, result);
}

// ─── New: extractFromMemoryJNI ─────────────────────────────────────────
// Reads audio data from a byte array (loaded in Kotlin from content:// URI)
// and decodes/encodes to FLAC without any temp file.
extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_extractFromMemoryJNI(
    JNIEnv *env, jobject thiz, jbyteArray data, jstring outputPath) {

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    jsize data_size = env->GetArrayLength(data);
    jbyte* data_ptr = env->GetByteArrayElements(data, nullptr);

    ekwe::DecodeResult result = ekwe::extract_audio_and_waveform_from_memory(
        reinterpret_cast<const uint8_t*>(data_ptr),
        static_cast<size_t>(data_size),
        output
    );

    env->ReleaseByteArrayElements(data, data_ptr, JNI_ABORT);

    return buildResultArray(env, result);
}

// ─── New: AudioRecord streaming FLAC encoder JNI ───────────────────────

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeInitFlacEncoder(
    JNIEnv *env, jobject thiz, jstring outputPath, jint sampleRate, jint channels) {

    // Clean up any previous encoder (shouldn't happen, but be safe)
    if (g_flac_encoder) {
        delete g_flac_encoder;
        g_flac_encoder = nullptr;
    }

    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);
    std::string output(output_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    g_flac_encoder = new ekwe::FlacStreamEncoder(
        output,
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        true  // enable DC-blocking high-pass filter
    );

    return g_flac_encoder->is_ok() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeFeedPcm(
    JNIEnv *env, jobject thiz, jshortArray pcmData, jint numSamples) {

    if (!g_flac_encoder) return JNI_FALSE;

    jshort* pcm_ptr = env->GetShortArrayElements(pcmData, nullptr);

    bool ok = g_flac_encoder->feed_pcm(
        reinterpret_cast<const int16_t*>(pcm_ptr),
        static_cast<size_t>(numSamples)
    );

    env->ReleaseShortArrayElements(pcmData, pcm_ptr, JNI_ABORT);

    return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_nativeStopFlacEncoder(
    JNIEnv *env, jobject thiz) {

    if (!g_flac_encoder) {
        // Return a failure result
        ekwe::DecodeResult dummy;
        dummy.success = false;
        dummy.error_message = "No active encoder";
        return buildResultArray(env, dummy);
    }

    ekwe::DecodeResult result = g_flac_encoder->finalize();
    delete g_flac_encoder;
    g_flac_encoder = nullptr;

    return buildResultArray(env, result);
}
