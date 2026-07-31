#pragma once

#include <cstdint>
#include <vector>

struct OpusEncoder;

namespace ekwe {

class OpusStreamEncoder {
public:
    OpusStreamEncoder(uint32_t sample_rate, uint16_t channels, int complexity = 3);
    ~OpusStreamEncoder();

    bool is_ok() const { return ok_; }

    bool encode_frame(const int16_t* pcm, size_t num_samples, std::vector<uint8_t>& output);

    uint32_t sample_rate() const { return sample_rate_; }
    uint16_t channels() const { return channels_; }
    int lookahead() const { return lookahead_; }

    OpusStreamEncoder(const OpusStreamEncoder&) = delete;
    OpusStreamEncoder& operator=(const OpusStreamEncoder&) = delete;

private:
    bool ok_;
    ::OpusEncoder* encoder_;
    uint32_t sample_rate_;
    uint16_t channels_;
    int lookahead_;
};

} // namespace ekwe
