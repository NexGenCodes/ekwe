#include "EkweWaveform.h"

#include <algorithm>
#include <cmath>

namespace ekwe {
namespace {

// Relative peak below which a clip counts as near-silence. Normalising against a
// peak this small would inflate noise into a full-scale waveform, so the
// divisor is clamped to the floor instead.
constexpr float kNoiseFloor = 0.02f;

// Full-scale positive int16 magnitude. 32768 (the magnitude of -32768) is used
// rather than 32767 so a single full-scale negative sample reaches exactly 1.0.
constexpr float kFullScale = 32768.0f;

} // namespace

std::vector<float> compute_waveform(const std::vector<int16_t>& pcm,
                                    size_t num_bins) {
    std::vector<float> waveform;
    if (pcm.empty() || num_bins == 0) {
        return waveform;
    }

    // A clip shorter than the bin count gets one bin per sample rather than a
    // mostly-empty 60-bar result that renders as a flat line.
    if (num_bins > pcm.size()) {
        num_bins = pcm.size();
    }

    waveform.reserve(num_bins);
    float peak = 0.0f;

    for (size_t i = 0; i < num_bins; ++i) {
        // Index-scaled bin edges so the whole buffer is covered; integer
        // division per bin drops the tail when the length is not a multiple of
        // the bin count.
        const size_t begin = (i * pcm.size()) / num_bins;
        size_t end = ((i + 1) * pcm.size()) / num_bins;
        if (end <= begin) {
            end = begin + 1;
        }

        // std::abs on int16_t promotes to int, so -32768 becomes 32768 without
        // overflow. Accumulating in int32_t avoids the wrap that casting the
        // magnitude back to int16_t would introduce.
        int32_t bin_peak = 0;
        for (size_t j = begin; j < end && j < pcm.size(); ++j) {
            const int32_t magnitude = std::abs(static_cast<int32_t>(pcm[j]));
            bin_peak = std::max(bin_peak, magnitude);
        }

        const float normalized = static_cast<float>(bin_peak) / kFullScale;
        waveform.push_back(normalized);
        peak = std::max(peak, normalized);
    }

    if (peak > 0.0f) {
        const float divisor = std::max(peak, kNoiseFloor);
        for (float& value : waveform) {
            value = std::min(1.0f, value / divisor);
        }
    }

    return waveform;
}

} // namespace ekwe
