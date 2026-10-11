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

# libvorbis is compiled directly rather than via its own CMakeLists, which is
# the same call as opusfile above: its find_package(Ogg) expects an installed
# libogg, while ours is the add_subdirectory() target. vorbisfile.c is the
# only file left out — it is the streaming-read API, and this build only ever
# writes.
set(VORBIS_SRC
    ../cpp/thirdparty/libvorbis/lib/analysis.c
    ../cpp/thirdparty/libvorbis/lib/bitrate.c
    ../cpp/thirdparty/libvorbis/lib/block.c
    ../cpp/thirdparty/libvorbis/lib/codebook.c
    ../cpp/thirdparty/libvorbis/lib/envelope.c
    ../cpp/thirdparty/libvorbis/lib/floor0.c
    ../cpp/thirdparty/libvorbis/lib/floor1.c
    ../cpp/thirdparty/libvorbis/lib/info.c
    ../cpp/thirdparty/libvorbis/lib/lookup.c
    ../cpp/thirdparty/libvorbis/lib/lpc.c
    ../cpp/thirdparty/libvorbis/lib/lsp.c
    ../cpp/thirdparty/libvorbis/lib/mapping0.c
    ../cpp/thirdparty/libvorbis/lib/mdct.c
    ../cpp/thirdparty/libvorbis/lib/psy.c
    ../cpp/thirdparty/libvorbis/lib/registry.c
    ../cpp/thirdparty/libvorbis/lib/res0.c
    ../cpp/thirdparty/libvorbis/lib/sharedbook.c
    ../cpp/thirdparty/libvorbis/lib/smallft.c
    ../cpp/thirdparty/libvorbis/lib/synthesis.c
    ../cpp/thirdparty/libvorbis/lib/vorbisenc.c
    ../cpp/thirdparty/libvorbis/lib/window.c
)
add_library(vorbis STATIC ${VORBIS_SRC})
target_include_directories(vorbis PUBLIC
    ../cpp/thirdparty/libvorbis/include
    ../cpp/thirdparty/libogg/include
)
target_include_directories(vorbis PRIVATE
    ../cpp/thirdparty/libvorbis/lib
)
target_link_libraries(vorbis PUBLIC ogg)

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

# Our EkweAudioDecoder + the Vorbis encoder the Wit.ai path needs
add_library(ekwe_audio_decoder STATIC
    ../cpp/EkweAudioDecoder.cpp
    ../cpp/EkweVorbisEncoder.cpp
)
target_include_directories(ekwe_audio_decoder PUBLIC
    ../cpp
    ../cpp/thirdparty
    ../cpp/thirdparty/opusfile/include
    ../cpp/thirdparty/opus/include
    ../cpp/thirdparty/libogg/include
    ../cpp/thirdparty/libvorbis/include
)
target_link_libraries(ekwe_audio_decoder PRIVATE opusfile vorbis ekwe_opus_util)

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

