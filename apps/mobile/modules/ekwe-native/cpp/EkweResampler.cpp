#include "EkweResampler.h"

#include "thirdparty/r8brain/CDSPResampler.h"

#include <cmath>

namespace ekwe {

namespace {
// r8brain streams input in chunks no larger than the constructor's max input
// length; this is the working chunk size for the whole-buffer conversion.
constexpr int kMaxInLen = 1 << 15;
} // namespace

bool resample_mono_int16(const int16_t* input, size_t count,
                         uint32_t from_rate, uint32_t to_rate,
                         std::vector<int16_t>& output) {
    if (input == nullptr || count == 0) return true;
    if (from_rate == 0 || to_rate == 0) return false;
    if (from_rate == to_rate) return true;

    const long long out_len =
        static_cast<long long>(count) * to_rate / from_rate;
    if (out_len <= 0) {
        output.clear();
        return true;
    }

    std::vector<float> in_f(count);
    for (size_t i = 0; i < count; ++i) {
        in_f[i] = static_cast<float>(input[i]);
    }
    std::vector<float> out_f(static_cast<size_t>(out_len));

    // oneshot() consumes the whole input and zero-pads internally to emit
    // exactly out_len samples, so no explicit flush or tail buffer is needed.
    r8b::CDSPResampler16 resampler(static_cast<double>(from_rate),
                                   static_cast<double>(to_rate), kMaxInLen);
    resampler.oneshot<float, float>(in_f.data(), static_cast<int>(count),
                                    out_f.data(), static_cast<int>(out_len));

    output.resize(static_cast<size_t>(out_len));
    for (size_t i = 0; i < static_cast<size_t>(out_len); ++i) {
        float v = out_f[i];
        if (v > 32767.0f) {
            v = 32767.0f;
        } else if (v < -32768.0f) {
            v = -32768.0f;
        }
        output[i] = static_cast<int16_t>(std::lround(v));
    }
    return true;
}

} // namespace ekwe
