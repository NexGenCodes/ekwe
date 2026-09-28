cmake_minimum_required(VERSION 3.10.2)

project(EkweNative)

# Set common flags
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fPIC")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fPIC")

# Disable unnecessary things in ogg and opus
set(BUILD_TESTING OFF CACHE BOOL "Disable testing" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static libs" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "Disable opus programs" FORCE)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "Disable opus testing" FORCE)
set(OPUS_BUILD_SHARED_LIBRARY OFF CACHE BOOL "Disable opus shared lib" FORCE)

# Add libogg
add_subdirectory(../cpp/thirdparty/libogg libogg_build)

# Add libopus
add_subdirectory(../cpp/thirdparty/opus libopus_build)

# Opusfile doesn't have CMake, we compile it directly
set(OPUSFILE_SRC
    ../cpp/thirdparty/opusfile/src/info.c
    ../cpp/thirdparty/opusfile/src/internal.c
    ../cpp/thirdparty/opusfile/src/opusfile.c
    ../cpp/thirdparty/opusfile/src/stream.c
)
add_library(opusfile STATIC ${OPUSFILE_SRC})
target_include_directories(opusfile PUBLIC 
    ../cpp/thirdparty/opusfile/include
    ../cpp/thirdparty/libogg/include
    ../cpp/thirdparty/opus/include
)
target_link_libraries(opusfile PUBLIC ogg opus)

# Shared Opus/Ogg utilities (used by decoder and capture engine)
add_library(ekwe_opus_util STATIC
    ../cpp/EkweOpusEncoder.cpp
    ../cpp/EkweOggMuxer.cpp
    ../cpp/EkweCafMuxer.cpp
    ../cpp/EkweWaveform.cpp
)
target_include_directories(ekwe_opus_util PUBLIC
    ../cpp
    ../cpp/thirdparty
    ../cpp/thirdparty/opus/include
    ../cpp/thirdparty/libogg/include
)
target_link_libraries(ekwe_opus_util PUBLIC opus ogg)

# Our EkweAudioDecoder
add_library(ekwe_audio_decoder STATIC
    ../cpp/EkweAudioDecoder.cpp
)
target_include_directories(ekwe_audio_decoder PUBLIC
    ../cpp
    ../cpp/thirdparty
    ../cpp/thirdparty/opusfile/include
    ../cpp/thirdparty/opus/include
    ../cpp/thirdparty/libogg/include
)
target_link_libraries(ekwe_audio_decoder PRIVATE opusfile ekwe_opus_util)

# Capture engine (CaptureController)
# Links ekwe_audio_decoder because stop() re-decodes the finished Ogg to derive
# the waveform through the same code the shared/imported path uses.
add_library(ekwe_capture_engine STATIC
    ../cpp/EkweCaptureController.cpp
)
target_include_directories(ekwe_capture_engine PUBLIC
    ../cpp
    ../cpp/thirdparty
    ../cpp/thirdparty/opusfile/include
    ../cpp/thirdparty/opus/include
    ../cpp/thirdparty/libogg/include
)
target_link_libraries(ekwe_capture_engine PRIVATE ekwe_opus_util ekwe_audio_decoder)

# JNI Interface — define the target BEFORE including the Nitrogen autolinking
# cmake, which calls target_sources() / target_link_libraries() on it.
add_library(ekwe_native_jni SHARED
    EkweNativeModuleJNI.cpp
    cpp-adapter.cpp
    ../cpp/HybridEkweAudio.cpp
)

target_include_directories(ekwe_native_jni PRIVATE
    ../../../node_modules/react-native/ReactCommon
    ../../../node_modules/react-native/ReactCommon/jsi
    ../cpp
    ../nitrogen/generated/android
)

target_compile_features(ekwe_native_jni PUBLIC cxx_std_20)

# Nitrogen autolinking — adds generated sources, include dirs, find_package()
# for fbjni / ReactAndroid / react-native-nitro-modules, and links them all.
include(${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/ekwe_native_jni+autolinking.cmake)

# Link our own static libraries (autolinking already links fbjni, ReactAndroid, NitroModules)
target_link_libraries(ekwe_native_jni
    ekwe_audio_decoder
    ekwe_capture_engine
    log
)

