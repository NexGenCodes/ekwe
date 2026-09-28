#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ekwe {

// Number of waveform bars the UI renders. Fixed so a recording and a shared
// file are directly comparable side by side in the same list.
constexpr size_t kWaveformBins = 60;

// The single waveform algorithm in this module.
//
// Both recorded and shared/imported audio derive their waveform from decoded
// mono PCM through this function, so the same content looks identical whether
// it was just recorded or picked from the share sheet.
//
// It is deliberately NOT derived from live capture metering. Metering is a
// per-frame RMS stream that does not exist for imported files, and
// approximating a waveform from it produced a visibly different shape than the
// same audio decoded from disk (RMS blends peak and mean, then floors every
// bin at 0.02, which flattens transients).
//
// Each bin is the peak absolute amplitude in that slice of PCM, which keeps
// transients — plosives, consonants, syllable onsets — visible instead of
// averaging them away. The series is then normalised against its own peak so a
// quiet recording is still legible, with a noise floor so near-silence is not
// amplified into a misleading full-scale waveform.
//
// `pcm` must be mono. Returns an empty vector when there is nothing to plot.
std::vector<float> compute_waveform(const std::vector<int16_t>& pcm,
                                    size_t num_bins = kWaveformBins);

} // namespace ekwe
