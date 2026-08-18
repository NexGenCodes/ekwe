Pod::Spec.new do |s|
  s.name           = 'EkweNative'
  s.version        = '1.0.0'
  s.summary        = 'Ekwe native audio capture, Opus/Ogg encoding and Opus-in-CAF remuxing'
  s.description    = 'Native C++ audio pipeline: capture + Ogg Opus recording, and an iOS Opus-in-CAF decoder so AVPlayer can play Ogg Opus recordings without a WAV round-trip.'
  s.author         = 'Ekwe'
  s.homepage       = 'https://ekwe.app'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # ── Compile sources ──────────────────────────────────────────────────────
  # The podspec lives at the module root so it can reach both ios/ (Swift +
  # ObjC bridge) and cpp/ (C++ core + vendored libogg/libopus/opusfile).
  #
  # libopus: celt + silk + src, FLOATING_POINT, no fixed-point (silk/fixed is
  # mutually exclusive with silk/float and is NOT compiled). The C standard
  # library headers plus -DVAR_ARRAYS replace the config.h that autotools/cmake
  # would generate (see GCC_PREPROCESSOR_DEFINITIONS).
  #
  # opusfile: only the four pure-codec sources (info/internal/opusfile/stream).
  # http.c and wincerts.c pull in HTTP/SSL deps we don't need.
  #
  # Only the ekwe C++ core headers live at cpp/ root; the vendored thirdparty
  # headers are discovered via HEADER_SEARCH_PATHS and are NOT in source_files
  # (avoids bundling thousands of vendored headers into the pod's header phase).
  s.source_files =
    "ios/**/*.{h,m,mm,swift,hpp,cpp}",
    "cpp/*.{h,hpp,cpp}",
    "cpp/thirdparty/libogg/src/*.c",
    "cpp/thirdparty/opus/celt/*.c",
    "cpp/thirdparty/opus/silk/*.c",
    "cpp/thirdparty/opus/silk/float/*.c",
    "cpp/thirdparty/opus/src/*.c",
    "cpp/thirdparty/opusfile/src/{info,internal,opusfile,stream}.c"

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_OBJC_BRIDGING_HEADER' => '${PODS_TARGET_SRCROOT}/ios/EkweNative-Bridging-Header.h',

    # Header search paths for the C++ core and vendored thirdparty includes.
    # `thirdparty/miniaudio.h`, opusfile/opus/ogg includes and the checked-in
    # `ogg/config_types.h` all resolve through these. celt/silk/float are the
    # internal dirs that libopus's own CMake target adds; CocoaPods must too.
    'HEADER_SEARCH_PATHS' => [
      '$(PODS_TARGET_SRCROOT)/cpp',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/celt',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/silk',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opus/silk/float',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/opusfile/include',
      '$(PODS_TARGET_SRCROOT)/cpp/thirdparty/libogg/include',
    ].join(' '),

    # Replace libopus's generated config.h: no HAVE_CONFIG_H, stack allocation
    # via C99 variable-length arrays (OPUS_BUILD + FLOATING_POINT mirror the
    # CMake default). Keep the C sources on C99 and the C++ on gnu++14.
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) VAR_ARRAYS=1 OPUS_BUILD=1 FLOATING_POINT=1',
    'GCC_C_LANGUAGE_STANDARD' => 'gnu99',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++14',
  }
end
