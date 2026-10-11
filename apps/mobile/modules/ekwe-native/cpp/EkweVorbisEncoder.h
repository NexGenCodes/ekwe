#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

#include "EkweAudioDecoder.h"

namespace ekwe {

constexpr int kDefaultVorbisBitrateKbps = 32;

bool encode_vorbis(const std::vector<int16_t>& mono_samples,
                   uint32_t sample_rate,
                   uint16_t channels,
                   const std::string& output_path,
                   int target_kbps = kDefaultVorbisBitrateKbps);

DecodeResult encode_pcm_to_vorbis(const std::string& output_path,
                                  const int16_t* pcm_data,
                                  size_t num_samples,
                                  uint32_t sample_rate,
                                  uint16_t channels,
                                  int target_kbps = kDefaultVorbisBitrateKbps);

} // namespace ekwe
