#!/usr/bin/env bash
# Builds and runs the capture-thread callback-handoff thread-safety tests for
# ekwe::CallbackSlot. Not wired into the app build: these are host-side checks
# for threading behaviour that otherwise only shows up on a device.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cpp="$(cd "${here}/.." && pwd)"
out="${TMPDIR:-/tmp}/ekwe_callback_tests"

cxx="${CXX:-g++}"

# Built at the standard both production targets use. Note the host libstdc++ has
# std::atomic<std::shared_ptr<T>> (C++20) and the Android NDK's libc++ does not,
# so anything that reaches for it compiles here and then fails in the app build —
# which is why ekwe::AtomicShared exists.
flags=(-std=c++20 -g -Wall -Wextra -Wno-unused-parameter)
incs=(-I"${cpp}")

# TSan is the point of this suite: it reports the data race a lock-free handoff
# would otherwise hide. It needs ASLR off to reserve its shadow region, hence
# the setarch -R retry at the end.
san=()
if printf 'int main(){return 0;}' | "${cxx}" -fsanitize=thread -x c++ - -o /dev/null 2>/dev/null; then
  san=(-fsanitize=thread)
  echo "tsan: enabled"
else
  echo "tsan: unavailable, running without it"
fi

sources=("${here}/callback_dispatch_test.cpp")

echo "building ${out}"
"${cxx}" "${flags[@]}" "${san[@]}" "${incs[@]}" "${sources[@]}" -o "${out}" -lpthread

if [ ${#san[@]} -gt 0 ] && ! "${out}" 2>/dev/null; then
  if command -v setarch >/dev/null 2>&1 && setarch -R "${out}"; then
    exit 0
  fi
  echo "tsan: run failed, and setarch -R could not be used to retry" >&2
  exit 1
fi

"${out}"
