#!/usr/bin/env bash
# Builds and runs the native C++ tests. Not wired into the app build: these are
# host-side checks for capture logic that otherwise only shows up on a device.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cpp="$(cd "${here}/.." && pwd)"
out="${TMPDIR:-/tmp}/ekwe_native_tests"

# Opus/Ogg/Vorbis ship as source under thirdparty/. There is nothing to build
# here, so prefer whatever the system already has and fall back to a bundled
# build. Distro installs often leave only the versioned sonames (no -dev
# symlink), so the versioned form is matched last as a catch-all.
find_lib() {
  local name="$1" dir match
  for dir in /usr/lib/"$(uname -m)"-linux-gnu /usr/lib64 /usr/lib /usr/local/lib \
             "${cpp}/thirdparty/${name}/lib" "${cpp}/thirdparty/lib${name}/lib"; do
    if [ -e "${dir}/lib${name}.so" ]; then printf '%s' "${dir}/lib${name}.so"; return 0; fi
    if [ -e "${dir}/lib${name}.a" ];  then printf '%s' "${dir}/lib${name}.a";  return 0; fi
    if [ -e "${dir}/lib${name}.so.0" ]; then printf '%s' "${dir}/lib${name}.so.0"; return 0; fi
    for match in "${dir}"/lib"${name}".so.*; do
      if [ -e "${match}" ]; then printf '%s' "${match}"; return 0; fi
    done
  done
  return 1
}

# vorbisenc must precede vorbis: the former calls into the latter. vorbisfile
# pulls in vorbis + ogg as well; list it last so the linker resolves the
# higher-level symbols first.
link_flags=()
for name in opusfile ogg opus vorbisenc vorbis vorbisfile; do
  if found="$(find_lib "$name")"; then
    link_flags+=("${found}")
  else
    echo "error: lib${name} not found." >&2
    echo "       install the -dev packages, or build thirdparty/${name}." >&2
    exit 1
  fi
done

cxx="${CXX:-g++}"
flags=(-std=c++17 -g -Wall -Wextra -Wno-unused-parameter)
incs=(-I"${cpp}"
      -I"${cpp}/thirdparty/opus/include"
      -I"${cpp}/thirdparty/libogg/include"
      -I"${cpp}/thirdparty/libvorbis/include"
      -I"${cpp}/thirdparty/opusfile/include")

# ASan catches the buffer overruns this code sits next to. Probe first, since
# not every toolchain can link it.
san=()
if printf 'int main(){return 0;}' | "${cxx}" -fsanitize=address -x c++ - -o /dev/null 2>/dev/null; then
  san=(-fsanitize=address)
  echo "asan: enabled"
else
  echo "asan: unavailable, running without it"
fi

# Everything under test, minus the mains: each test file builds its own binary
# so a fixture clash between suites cannot silently disable a check.
sources=(
  "${cpp}/EkweCaptureController.cpp"
  "${cpp}/EkweOpusEncoder.cpp"
  "${cpp}/EkweOggMuxer.cpp"
  "${cpp}/EkweAudioDecoder.cpp"
  "${cpp}/EkweResampler.cpp"
  "${cpp}/EkweVorbisEncoder.cpp"
  "${cpp}/EkweWaveform.cpp"
)

# The capture-thread callback tests live in run-callback-tests.sh: they need
# C++20 and TSan, neither of which this suite probes for.
tests=(capture_leading_silence_test vorbis_encode_test audio_paths_test)

fail=0
for name in "${tests[@]}"; do
  bin="${out}_${name}"
  echo "building ${bin}"
  "${cxx}" "${flags[@]}" "${san[@]}" "${incs[@]}" "${here}/${name}.cpp" "${sources[@]}" \
    "${link_flags[@]}" -o "${bin}"
  "${bin}" || fail=1
done

exit "${fail}"
