#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>

struct OpusEncoder;

namespace ekwe {

class OpusStreamEncoder {
public:
    // complexity: Opus search effort (0-10). Left to the default at every call
    // site on purpose — the recorder, the file transcode path, and the CAF
    // fallback all encode through this one default so an imported file and a
    // recording of the same audio come out with identical encoder settings.
    // Overriding it at a call site is what previously made transcodes quietly
    // differ from recordings.
    //
    // enable_fec/packet_loss_perc: optional in-band FEC for lossy transports
    // (e.g. RTP/UDP). Off by default — the live path here streams over TCP
    // WebSocket with a decoder that never passes the FEC flag, so enabling it
    // would only cost bitrate with nothing to recover.
    OpusStreamEncoder(uint32_t sample_rate,
                      uint16_t channels,
                      int complexity = 5,
                      bool enable_fec = false,
                      int packet_loss_perc = 0);
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
