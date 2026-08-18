#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <utility>

namespace ekwe {

// Writes Opus packets into an Apple Core Audio Format (CAF) container so iOS
// can play them natively via AVPlayer/AVAudioPlayer (iOS 11+). Byte layout:
// 'caff' file header → 'desc' (Audio Description) → 'kuki' (magic cookie =
// OpusHead verbatim) → 'pakt' (packet table of (byte size, frame count) varint
// pairs) → 'data' (edit count + concatenated packets).
//
// Audio is buffered in memory and serialized once on finalize(), so the 'pakt'
// totals (number of valid frames, priming) are authoritative even though
// packets are appended incrementally.
class CafMuxer {
public:
    // output_path: destination file. sample_rate: Opus decode rate (48 kHz).
    CafMuxer(const std::string& output_path, uint32_t sample_rate, uint16_t channels);
    ~CafMuxer();

    bool is_ok() const { return ok_; }

    // Use a verbatim OpusHead magic cookie (from a source Ogg). pre_skip must
    // be in 48 kHz samples. Returns false for a malformed cookie.
    bool set_opus_head(const uint8_t* data, size_t size, uint64_t pre_skip);

    // Synthesize an OpusHead magic cookie (RFC 7845) from first principles.
    // pre_skip must be in 48 kHz samples (encoder.lookahead() * 48000 / sr).
    bool write_opus_header(int channels, int pre_skip, uint32_t input_sample_rate);

    // Append one Opus packet. frames is the packet's decoded length at 48 kHz.
    bool write_packet(const uint8_t* opus_data, size_t opus_size, uint64_t frames);

    // Serialize the assembled CAF to output_path. Idempotent. Returns false
    // when nothing was written (no packets) — callers decide how to surface that.
    bool finalize();

    CafMuxer(const CafMuxer&) = delete;
    CafMuxer& operator=(const CafMuxer&) = delete;

private:
    bool ok_;
    bool finalized_;
    std::string output_path_;
    uint16_t channels_;
    uint64_t pre_skip_;
    uint64_t total_frames_;
    uint64_t total_packets_;
    std::vector<uint8_t> opus_head_;
    std::vector<uint8_t> audio_bytes_;
    std::vector<std::pair<uint64_t, uint64_t>> entries_; // (byte size, frames) per packet

    static void put_fourcc(std::vector<uint8_t>& out, const char (&cc)[5]);
    static void put_u16(std::vector<uint8_t>& out, uint16_t v);
    static void put_u32(std::vector<uint8_t>& out, uint32_t v);
    static void put_u64(std::vector<uint8_t>& out, uint64_t v);
    static void put_f64(std::vector<uint8_t>& out, double v);
    static void put_varint(std::vector<uint8_t>& out, uint64_t v);
};

} // namespace ekwe
