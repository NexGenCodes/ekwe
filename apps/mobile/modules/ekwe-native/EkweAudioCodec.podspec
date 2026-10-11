Pod::Spec.new do |s|
  s.name           = 'EkweAudioCodec'
  s.version        = '1.0.0'
  s.summary        = 'Ekwe audio transcode runtime'
  s.description    = 'C++ encoder/decoder + bridge for the Ekwe share extension, without linking ExpoModulesCore.'
  s.author         = 'Ekwe'
  s.homepage       = 'https://ekwe.pages.dev'
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files =
    "ios/EkweAudioCodecBridge.{h,mm}",
    "cpp/*.{h,hpp,cpp}",
    "cpp/thirdparty/libogg/src/*.c",
    "cpp/thirdparty/opus/celt/*.c",
    "cpp/thirdparty/opus/silk/*.c",
    "cpp/thirdparty/opus/silk/float/*.c",
    "cpp/thirdparty/opus/src/*.c",
    "cpp/thirdparty/opusfile/src/{info,internal,opusfile,stream}.c",
    # Full libvorbis + vorbisfile (the streaming read API the Ogg Vorbis decode
    # and Ogg → WAV bridge need) — matches android/CMakeLists.txt so both
    # platforms compile the same objects.
    "cpp/thirdparty/libvorbis/lib/{analysis,bitrate,block,codebook,envelope,floor0,floor1,info,lookup,lpc,lsp,mapping0,mdct,psy,registry,res0,sharedbook,smallft,synthesis,vorbisenc,vorbisfile,window}.c"

  # HybridEkweAudio is the Nitro hybrid that exposes the capture path to JS. It
  # includes <NitroModules/ArrayBuffer.hpp> and defines no get_current_rms (that
  # lives in the app-side bridges), so it cannot build in this Expo-free pod and
  # is not part of what the share extension needs.
  s.exclude_files = "cpp/HybridEkweAudio.{hpp,cpp}"

  s.public_header_files = "ios/EkweAudioCodecBridge.h"

  # AVFoundation decodes non-Ogg sources to PCM and provides the CoreMedia
  # sample-buffer types; AudioToolbox's ExtAudioFile writes the M4A playback copy.
  s.frameworks = "Foundation", "AVFoundation", "CoreMedia", "AudioToolbox"

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => [
      '$(inherited)',
      '$(PODS_TARGET_SRCROOT)/cpp',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/celt',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/silk',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/silk/float',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opusfile/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/libogg/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/libvorbis/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/libvorbis/lib',
    ].join(' '),
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) VAR_ARRAYS=1 OPUS_BUILD=1 FLOATING_POINT=1',
    'GCC_C_LANGUAGE_STANDARD' => 'gnu99',
    # The app pod gets C++20 from nitrogen's autolinking, which does not run
    # here. EkweCallbackSlot.hpp needs C++17 for its inline static registry.
    'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++17',
  }
end
