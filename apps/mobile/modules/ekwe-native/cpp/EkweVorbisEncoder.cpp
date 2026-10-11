#include "EkweVorbisEncoder.h"

#include "EkweWaveform.h"

#include <ogg/ogg.h>
#include <vorbis/codec.h>
#include <vorbis/vorbisenc.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace ekwe {
namespace {

constexpr int kAnalysisBlockSize = 1024;
constexpr long kOggSerial = 0x656B7765;
constexpr float kFallbackQuality = 0.4f;

struct EncoderState {
    vorbis_info info;
    vorbis_comment comment;
    vorbis_dsp_state dsp;
    vorbis_block block;
    ogg_stream_state stream;

    bool has_info = false;
    bool has_comment = false;
    bool has_dsp = false;
    bool has_block = false;
    bool has_stream = false;

    ~EncoderState() {
        if (has_stream) ogg_stream_clear(&stream);
        if (has_block) vorbis_block_clear(&block);
        if (has_dsp) vorbis_dsp_clear(&dsp);
        if (has_comment) vorbis_comment_clear(&comment);
        // vorbis_info_clear() zeroes the struct as it frees, so it is safe to
        // call on a setup that already failed and cleared itself.
        if (has_info) vorbis_info_clear(&info);
    }

    EncoderState(const EncoderState&) = delete;
    EncoderState& operator=(const EncoderState&) = delete;
    EncoderState() = default;
};

bool write_page(FILE* file, const ogg_page& page) {
    const auto header_len = static_cast<size_t>(page.header_len);
    const auto body_len = static_cast<size_t>(page.body_len);
    if (std::fwrite(page.header, 1, header_len, file) != header_len) return false;
    if (body_len > 0 && std::fwrite(page.body, 1, body_len, file) != body_len) {
        return false;
    }
    return true;
}

// Picks the encode mode.
//
// A positive `target_kbps` selects libvorbis's managed mode around that
// nominal rate: the reservoir spends bits on speech and gives silence back,
// but the average stays near the target, which is what keeps a ≤290 s clip
// comfortably inside MAX_AUDIO_BYTES instead of only landing there on average.
// A non-positive `target_kbps` asks for pure quality-based VBR instead.
int setup_vorbis_info(vorbis_info* info, int channels, long rate, int target_kbps) {
    if (target_kbps > 0) {
        const long nominal = static_cast<long>(target_kbps) * 1000L;
        const int ret = vorbis_encode_init(info, channels, rate, -1, nominal, -1);
        if (ret == 0) return 0;
        vorbis_info_init(info);
    }
    return vorbis_encode_init_vbr(info, channels, rate, kFallbackQuality);
}

// Pulls every packet the DSP has finished into the Ogg stream and writes out
// whatever pages that completes. Returns false only on a write failure —
// libvorbis signalling "no packet yet" is the normal end of the loop.
bool drain_packets(EncoderState& state, FILE* file) {
    ogg_packet packet;
    ogg_page page;

    while (vorbis_analysis_blockout(&state.dsp, &state.block) == 1) {
        if (vorbis_analysis(&state.block, nullptr) != 0) return false;
        if (vorbis_bitrate_addblock(&state.block) != 0) return false;

        while (vorbis_bitrate_flushpacket(&state.dsp, &packet) == 1) {
            if (ogg_stream_packetin(&state.stream, &packet) != 0) return false;
            while (ogg_stream_pageout(&state.stream, &page) == 1) {
                if (!write_page(file, page)) return false;
            }
        }
    }
    return true;
}

} // namespace

bool encode_vorbis(const std::vector<int16_t>& mono_samples,
                   uint32_t sample_rate,
                   uint16_t channels,
                   const std::string& output_path,
                   int target_kbps) {
    if (mono_samples.empty() || sample_rate == 0 || channels == 0 || channels > 2) {
        return false;
    }
    if (mono_samples.size() % channels != 0) {
        return false;
    }

    EncoderState state;

    vorbis_info_init(&state.info);
    state.has_info = true;
    if (setup_vorbis_info(&state.info, static_cast<int>(channels),
                          static_cast<long>(sample_rate), target_kbps) != 0) {
        return false;
    }

    vorbis_comment_init(&state.comment);
    state.has_comment = true;
    vorbis_comment_add_tag(&state.comment, "ENCODER", "Ekwe");

    if (vorbis_analysis_init(&state.dsp, &state.info) != 0) return false;
    state.has_dsp = true;
    if (vorbis_block_init(&state.dsp, &state.block) != 0) return false;
    state.has_block = true;
    if (ogg_stream_init(&state.stream, kOggSerial) != 0) return false;
    state.has_stream = true;

    FILE* file = std::fopen(output_path.c_str(), "wb");
    if (file == nullptr) return false;

    bool ok = true;

    // Identification, comment and setup packets must leave as one group on the
    // first page: a reader that sees any of them split from the others cannot
    // open the stream.
    ogg_packet header_main;
    ogg_packet header_comments;
    ogg_packet header_codebooks;
    if (vorbis_analysis_headerout(&state.dsp, &state.comment, &header_main,
                                  &header_comments, &header_codebooks) != 0) {
        ok = false;
    } else {
        ogg_stream_packetin(&state.stream, &header_main);
        ogg_stream_packetin(&state.stream, &header_comments);
        ogg_stream_packetin(&state.stream, &header_codebooks);

        ogg_page page;
        while (ok && ogg_stream_flush(&state.stream, &page) == 1) {
            ok = write_page(file, page);
        }
    }

    const size_t frame_count = mono_samples.size() / channels;
    size_t offset = 0;
    while (ok && offset < frame_count) {
        const size_t frames = std::min<size_t>(kAnalysisBlockSize, frame_count - offset);

        float** buffer = vorbis_analysis_buffer(&state.dsp, static_cast<int>(frames));
        if (buffer == nullptr) {
            ok = false;
            break;
        }
        for (uint16_t c = 0; c < channels; ++c) {
            float* dst = buffer[c];
            const size_t base = offset * channels + c;
            for (size_t i = 0; i < frames; ++i) {
                dst[i] = static_cast<float>(mono_samples[base + i * channels]) / 32768.0f;
            }
        }

        if (vorbis_analysis_wrote(&state.dsp, static_cast<int>(frames)) != 0) {
            ok = false;
            break;
        }
        if (!drain_packets(state, file)) {
            ok = false;
            break;
        }
        offset += frames;
    }

    // Zero frames signals end-of-stream: libvorbis emits its trailing blocks,
    // the last packet gets the eos flag, and the final partial page has to be
    // flushed by hand because pageout() only ever emits complete pages.
    if (ok && vorbis_analysis_wrote(&state.dsp, 0) != 0) ok = false;
    if (ok) ok = drain_packets(state, file);
    if (ok) {
        ogg_page page;
        while (ogg_stream_flush(&state.stream, &page) == 1) {
            if (!write_page(file, page)) {
                ok = false;
                break;
            }
        }
    }

    if (std::fclose(file) != 0) ok = false;

    if (!ok) {
        // A half-written artifact is worse than none: the caller would fall
        // back to the Opus upload believing this path was never attempted.
        std::remove(output_path.c_str());
    }
    return ok;
}

DecodeResult encode_pcm_to_vorbis(const std::string& output_path,
                                  const int16_t* pcm_data,
                                  size_t num_samples,
                                  uint32_t sample_rate,
                                  uint16_t channels,
                                  int target_kbps) {
    DecodeResult result;
    result.success = false;

    std::vector<int16_t> mono;
    if (!normalize_pcm_to_contract(pcm_data, num_samples, channels, sample_rate,
                                   mono, result.error_message)) {
        return result;
    }
    if (mono.empty()) {
        result.error_message = "PCM data is null or empty.";
        return result;
    }

    if (!encode_vorbis(mono, kRecorderSampleRate, kTargetChannels, output_path,
                       target_kbps)) {
        result.error_message = "Failed to encode Vorbis output.";
        return result;
    }

    result.duration_ms =
        static_cast<int>(mono.size() * 1000ULL / kRecorderSampleRate);
    result.waveform = compute_waveform(mono);
    result.success = true;
    return result;
}

} // namespace ekwe
