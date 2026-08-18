#include "EkweCafMuxer.h"

#include <cstdio>
#include <cstring>

#if defined(__ANDROID__)
#include <android/log.h>
#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkveCaf", fmt, ##__VA_ARGS__)
#else
#include <cstdio>
#define ALOG(fmt, ...) std::printf("[EkveCaf] " fmt "\n", ##__VA_ARGS__)
#endif

namespace ekwe {

// RFC 7845 — Opus always decodes at 48 kHz regardless of input sample rate.
static constexpr int32_t kOpusGranuleRate = 48000;

CafMuxer::CafMuxer(const std::string& output_path, uint32_t sample_rate, uint16_t channels)
    : ok_(false)
    , finalized_(false)
    , output_path_(output_path)
    , channels_(channels)
    , pre_skip_(0)
    , total_frames_(0)
    , total_packets_(0)
{
    (void)sample_rate; // the 'desc' chunk always records the 48 kHz decode rate
    ok_ = true;
}

CafMuxer::~CafMuxer() {}

bool CafMuxer::set_opus_head(const uint8_t* data, size_t size, uint64_t pre_skip) {
    if (!ok_ || size < 19) return false;
    opus_head_.assign(data, data + size);
    pre_skip_ = pre_skip;
    return true;
}

bool CafMuxer::write_opus_header(int channels, int pre_skip, uint32_t input_sample_rate) {
    // Synthesize the OpusHead magic cookie (RFC 7845), 19 bytes.
    std::vector<uint8_t> head(19, 0);
    std::memcpy(head.data(), "OpusHead", 8);
    head[8] = 1; // version
    head[9] = static_cast<uint8_t>(channels);
    head[10] = static_cast<uint8_t>(pre_skip & 0xFF);
    head[11] = static_cast<uint8_t>((pre_skip >> 8) & 0xFF);
    head[12] = static_cast<uint8_t>(input_sample_rate & 0xFF);
    head[13] = static_cast<uint8_t>((input_sample_rate >> 8) & 0xFF);
    head[14] = static_cast<uint8_t>((input_sample_rate >> 16) & 0xFF);
    head[15] = static_cast<uint8_t>((input_sample_rate >> 24) & 0xFF);
    head[16] = 0; // output gain
    head[17] = 0;
    head[18] = 0; // channel mapping family
    return set_opus_head(head.data(), head.size(), static_cast<uint64_t>(pre_skip));
}

bool CafMuxer::write_packet(const uint8_t* opus_data, size_t opus_size, uint64_t frames) {
    if (!ok_ || finalized_ || opus_size == 0 || frames == 0) return false;
    entries_.emplace_back(static_cast<uint64_t>(opus_size), frames);
    audio_bytes_.insert(audio_bytes_.end(), opus_data, opus_data + opus_size);
    total_frames_ += frames;
    ++total_packets_;
    return true;
}

bool CafMuxer::finalize() {
    if (finalized_) return ok_;
    finalized_ = true;
    if (!ok_ || opus_head_.empty() || total_packets_ == 0 || audio_bytes_.empty()) {
        // Nothing to serialize — no output file is created. CaptureController
        // ignores this on the live path; offline callers surface it as an error.
        return false;
    }

    std::vector<uint8_t> out;

    // CAF file header.
    put_fourcc(out, "caff");
    put_u16(out, 1); // file version
    put_u16(out, 0); // file flags

    // Audio Description chunk — required, must follow the file header.
    put_fourcc(out, "desc");
    put_u64(out, 32); // sizeof(CAFAudioFormat)
    put_f64(out, static_cast<double>(kOpusGranuleRate)); // Opus always decodes at 48 kHz
    put_fourcc(out, "opus");
    put_u32(out, 0); // format flags
    put_u32(out, 0); // bytes per packet → VBR
    put_u32(out, 0); // frames per packet → variable
    put_u32(out, channels_);
    put_u32(out, 0); // bits per channel (compressed)

    // Magic Cookie chunk: the OpusHead packet verbatim.
    put_fourcc(out, "kuki");
    put_u64(out, opus_head_.size());
    out.insert(out.end(), opus_head_.begin(), opus_head_.end());

    // Packet Table chunk: (byte size, frame count) varint pairs per packet.
    std::vector<uint8_t> entries;
    entries.reserve(total_packets_ * 4);
    for (const auto& e : entries_) {
        put_varint(entries, e.first);
        put_varint(entries, e.second);
    }
    const uint64_t pakt_size = 8 + 8 + 4 + 4 + entries.size();
    put_fourcc(out, "pakt");
    put_u64(out, pakt_size);
    put_u64(out, total_packets_);
    const uint64_t valid_frames = total_frames_ > pre_skip_ ? total_frames_ - pre_skip_ : 0;
    put_u64(out, valid_frames);
    put_u32(out, static_cast<uint32_t>(pre_skip_));
    put_u32(out, 0); // remainder frames
    out.insert(out.end(), entries.begin(), entries.end());

    // Audio Data chunk: 4-byte edit count + concatenated packets.
    put_fourcc(out, "data");
    put_u64(out, 4 + audio_bytes_.size());
    put_u32(out, 0); // edit count
    out.insert(out.end(), audio_bytes_.begin(), audio_bytes_.end());

    FILE* file = std::fopen(output_path_.c_str(), "wb");
    if (!file) {
        ALOG("finalize: fopen failed for path=%s", output_path_.c_str());
        return false;
    }
    const size_t written = std::fwrite(out.data(), 1, out.size(), file);
    std::fclose(file);
    if (written != out.size()) {
        ALOG("finalize: short write %zu/%zu", written, out.size());
        std::remove(output_path_.c_str());
        ok_ = false;
        return false;
    }
    ALOG("finalize: wrote %zu bytes (%llu packets)", out.size(),
         static_cast<unsigned long long>(total_packets_));
    return true;
}

void CafMuxer::put_fourcc(std::vector<uint8_t>& out, const char (&cc)[5]) {
    out.insert(out.end(), cc, cc + 4);
}

void CafMuxer::put_u16(std::vector<uint8_t>& out, uint16_t v) {
    out.push_back(static_cast<uint8_t>(v >> 8));
    out.push_back(static_cast<uint8_t>(v & 0xFF));
}

void CafMuxer::put_u32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back(static_cast<uint8_t>(v >> 24));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>(v & 0xFF));
}

void CafMuxer::put_u64(std::vector<uint8_t>& out, uint64_t v) {
    for (int i = 7; i >= 0; --i) {
        out.push_back(static_cast<uint8_t>((v >> (i * 8)) & 0xFF));
    }
}

void CafMuxer::put_f64(std::vector<uint8_t>& out, double v) {
    uint64_t bits = 0;
    std::memcpy(&bits, &v, sizeof(bits));
    put_u64(out, bits);
}

void CafMuxer::put_varint(std::vector<uint8_t>& out, uint64_t v) {
    // Big-endian 7-bit varint — the CAF "Packet Table" encoding FFmpeg's
    // cafdemuxer reads via ff_mp4_read_descr_len: 7 data bits per byte plus a
    // continuation bit.
    uint8_t tmp[10];
    int n = 0;
    tmp[n++] = static_cast<uint8_t>(v & 0x7F);
    v >>= 7;
    while (v != 0) {
        tmp[n++] = static_cast<uint8_t>((v & 0x7F) | 0x80);
        v >>= 7;
    }
    while (n > 0) {
        out.push_back(tmp[--n]);
    }
}

} // namespace ekwe