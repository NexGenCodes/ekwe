#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ekwe {

// Resamples mono int16 PCM between arbitrary sample rates with r8brain's
// high-quality low-pass resampler (MIT; vendored under thirdparty/r8brain).
//
// `output` is replaced with the converted samples. When `from_rate ==
// to_rate` or the input is empty this returns true and leaves `output`
// untouched (callers keep the original buffer). Returns false on failure.
//
// r8brain is header-only, so the implementation (and its includes) live in
// EkweResampler.cpp; this header stays free of the library so it can be
// included from translation units that never link the resampler.
bool resample_mono_int16(const int16_t* input, size_t count,
                         uint32_t from_rate, uint32_t to_rate,
                         std::vector<int16_t>& output);

} // namespace ekwe
