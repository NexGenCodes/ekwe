#include "EkweOpusEncoder.h"

#include <opus.h>
#include <cstring>
#include <algorithm>

#if defined(__ANDROID__)
#include <android/log.h>
#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkveEnc", fmt, ##__VA_ARGS__)
#else
#include <cstdio>
#define ALOG(fmt, ...) std::printf("[EkveEnc] " fmt "\n", ##__VA_ARGS__)
#endif

namespace ekwe {

OpusStreamEncoder::OpusStreamEncoder(uint32_t sample_rate, uint16_t channels, int complexity)
    : ok_(false)
    , encoder_(nullptr)
    , sample_rate_(sample_rate)
    , channels_(channels)
    , lookahead_(0)
{
    ALOG("constructor: sr=%d ch=%d", sample_rate, channels);
    int err = 0;
    encoder_ = opus_encoder_create(
        static_cast<opus_int32>(sample_rate),
        channels,
        OPUS_APPLICATION_VOIP,
        &err
    );
    if (err != OPUS_OK || !encoder_) {
        ALOG("constructor: opus_encoder_create failed err=%d", err);
        return;
    }
    ALOG("constructor: encoder created, configuring...");

    opus_encoder_ctl(encoder_, OPUS_SET_BITRATE(32000));
    opus_encoder_ctl(encoder_, OPUS_SET_COMPLEXITY(complexity));
    opus_encoder_ctl(encoder_, OPUS_SET_VBR(1));
    opus_encoder_ctl(encoder_, OPUS_SET_INBAND_FEC(0));
    opus_encoder_ctl(encoder_, OPUS_SET_PACKET_LOSS_PERC(0));
    opus_encoder_ctl(encoder_, OPUS_SET_SIGNAL(OPUS_SIGNAL_VOICE));

    opus_encoder_ctl(encoder_, OPUS_GET_LOOKAHEAD(&lookahead_));
    ALOG("constructor: lookahead=%d", lookahead_);

    ok_ = true;
    ALOG("constructor: SUCCESS");
}

OpusStreamEncoder::~OpusStreamEncoder() {
    if (encoder_) {
        ALOG("destructor: destroying encoder");
        opus_encoder_destroy(encoder_);
        encoder_ = nullptr;
    }
}

bool OpusStreamEncoder::encode_frame(const int16_t* pcm, size_t num_samples, std::vector<uint8_t>& output) {
    if (!ok_ || !encoder_) return false;

    const int frame_size = static_cast<int>(num_samples / channels_);
    if (frame_size == 0) return false;

    const int max_packet_size = 1500;
    output.resize(max_packet_size);

    const opus_int16* pcm_ptr = reinterpret_cast<const opus_int16*>(pcm);

    int len = opus_encode(encoder_, pcm_ptr, frame_size, output.data(), max_packet_size);
    if (len < 0) {
        ALOG("encode_frame FAILED len=%d", len);
        return false;
    }

    output.resize(static_cast<size_t>(len));
    return true;
}

} // namespace ekwe
