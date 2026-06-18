cmake_minimum_required(VERSION 3.10.2)

project(EkweNative)

# Set common flags
set(CMAKE_CXX_STANDARD 14)
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
target_link_libraries(opusfile PRIVATE ogg opus)

# libFLAC encoder
set(LIBFLAC_SRC
    ../cpp/thirdparty/flac/src/libFLAC/bitmath.c
    ../cpp/thirdparty/flac/src/libFLAC/bitwriter.c
    ../cpp/thirdparty/flac/src/libFLAC/cpu.c
    ../cpp/thirdparty/flac/src/libFLAC/crc.c
    ../cpp/thirdparty/flac/src/libFLAC/fixed.c
    ../cpp/thirdparty/flac/src/libFLAC/float.c
    ../cpp/thirdparty/flac/src/libFLAC/format.c
    ../cpp/thirdparty/flac/src/libFLAC/lpc.c
    ../cpp/thirdparty/flac/src/libFLAC/md5.c
    ../cpp/thirdparty/flac/src/libFLAC/memory.c
    ../cpp/thirdparty/flac/src/libFLAC/metadata_object.c
    ../cpp/thirdparty/flac/src/libFLAC/stream_encoder.c
    ../cpp/thirdparty/flac/src/libFLAC/stream_encoder_framing.c
    ../cpp/thirdparty/flac/src/libFLAC/window.c
    ../cpp/thirdparty/flac/src/libFLAC/bitreader.c
    ../cpp/thirdparty/flac/src/libFLAC/stream_decoder.c
)
add_library(flac STATIC ${LIBFLAC_SRC})
target_include_directories(flac PUBLIC
    ../cpp/thirdparty/flac/include
    ../cpp/thirdparty/flac/src/libFLAC/include
    ../cpp/thirdparty/flac
)
target_compile_definitions(flac PRIVATE
    FLAC__NO_DLL=1
    HAVE_CONFIG_H=1
)

# Our EkweAudioDecoder
add_library(ekwe_audio_decoder STATIC
    ../cpp/EkweAudioDecoder.cpp
)
target_include_directories(ekwe_audio_decoder PUBLIC
    ../cpp
    ../cpp/thirdparty
    ../cpp/thirdparty/opusfile/include
    ../cpp/thirdparty/flac/include
)
target_link_libraries(ekwe_audio_decoder PRIVATE opusfile ogg opus flac)

# JNI Interface
add_library(ekwe_native_jni SHARED
    EkweNativeModuleJNI.cpp
)

target_link_libraries(ekwe_native_jni PRIVATE 
    ekwe_audio_decoder
    log
)
