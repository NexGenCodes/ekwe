#include <jni.h>
#include <string>
#include <vector>
#include "../cpp/EkweAudioDecoder.h"

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_ekwenative_EkweNativeModule_extractWavAndWaveformJNI(JNIEnv *env, jobject thiz, jstring inputPath, jstring outputPath) {
    const char *input_c_str = env->GetStringUTFChars(inputPath, nullptr);
    const char *output_c_str = env->GetStringUTFChars(outputPath, nullptr);

    std::string input(input_c_str);
    std::string output(output_c_str);

    env->ReleaseStringUTFChars(inputPath, input_c_str);
    env->ReleaseStringUTFChars(outputPath, output_c_str);

    ekwe::DecodeResult result = ekwe::extract_audio_and_waveform(input, output);

    // Create a Java Map/Dictionary roughly, or a specific Result class.
    // Easiest is to return a Bundle or a custom class.
    // For simplicity, let's create an Object[] containing { Boolean success, String error, Integer duration, float[] waveform }
    // Or we return a Map/HashMap. Let's return an Object array to be extremely simple and parse in Kotlin.
    
    jclass objClass = env->FindClass("java/lang/Object");
    jobjectArray retArray = env->NewObjectArray(4, objClass, nullptr);

    // 0: success (Boolean)
    jclass booleanClass = env->FindClass("java/lang/Boolean");
    jmethodID booleanValueOf = env->GetStaticMethodID(booleanClass, "valueOf", "(Z)Ljava/lang/Boolean;");
    jobject successObj = env->CallStaticObjectMethod(booleanClass, booleanValueOf, result.success ? JNI_TRUE : JNI_FALSE);
    env->SetObjectArrayElement(retArray, 0, successObj);

    // 1: error (String)
    jstring errorStr = env->NewStringUTF(result.error_message.c_str());
    env->SetObjectArrayElement(retArray, 1, errorStr);

    // 2: duration (Integer)
    jclass integerClass = env->FindClass("java/lang/Integer");
    jmethodID integerValueOf = env->GetStaticMethodID(integerClass, "valueOf", "(I)Ljava/lang/Integer;");
    jobject durationObj = env->CallStaticObjectMethod(integerClass, integerValueOf, (jint)result.duration_ms);
    env->SetObjectArrayElement(retArray, 2, durationObj);

    // 3: waveform (float[])
    jfloatArray floatArray = env->NewFloatArray(result.waveform.size());
    if (result.waveform.size() > 0) {
        env->SetFloatArrayRegion(floatArray, 0, result.waveform.size(), result.waveform.data());
    }
    env->SetObjectArrayElement(retArray, 3, floatArray);

    return retArray;
}

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

    // Return same Object[4] format as extractWavAndWaveformJNI
    jclass objClass = env->FindClass("java/lang/Object");
    jobjectArray retArray = env->NewObjectArray(4, objClass, nullptr);

    // 0: success
    jclass booleanClass = env->FindClass("java/lang/Boolean");
    jmethodID booleanValueOf = env->GetStaticMethodID(booleanClass, "valueOf", "(Z)Ljava/lang/Boolean;");
    jobject successObj = env->CallStaticObjectMethod(booleanClass, booleanValueOf, result.success ? JNI_TRUE : JNI_FALSE);
    env->SetObjectArrayElement(retArray, 0, successObj);

    // 1: error / output path
    jstring errorStr = env->NewStringUTF(result.success ? output.c_str() : result.error_message.c_str());
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
