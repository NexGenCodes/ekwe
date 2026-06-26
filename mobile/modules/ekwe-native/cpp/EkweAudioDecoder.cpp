#include "EkweAudioDecoder.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>

#define MINIAUDIO_IMPLEMENTATION
#include "thirdparty/miniaudio.h"

// For Opus decoding
#include "thirdparty/opusfile/include/opusfile.h"

// For FLAC encoding
#include "FLAC/stream_encoder.h"

namespace ekwe {

static bool is_ogg_opus(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    char header[4];
    if (file.read(header, 4)) {
        return (header[0] == 'O' && header[1] == 'g' && header[2] == 'g' && header[3] == 'S');
    }
    return false;
}

// Extract max amplitude for 60 bins
static std::vector<float> compute_waveform(const std::vector<int16_t>& pcm_data) {
    std::vector<float> waveform;
    if (pcm_data.empty()) return waveform;

    int num_bins = 60;
    int samples_per_bin = pcm_data.size() / num_bins;
    if (samples_per_bin == 0) {
        samples_per_bin = 1;
        num_bins = pcm_data.size();
    }

    waveform.reserve(num_bins);
    float max_val = 0.0f;

    for (int i = 0; i < num_bins; ++i) {
        int start_idx = i * samples_per_bin;
        int end_idx = std::min((int)pcm_data.size(), (i + 1) * samples_per_bin);
        float bin_max = 0.0f;

        for (int j = start_idx; j < end_idx; ++j) {
            float val = std::abs((float)pcm_data[j] / 32768.0f);
            if (val > bin_max) bin_max = val;
        }

        waveform.push_back(bin_max);
        if (bin_max > max_val) max_val = bin_max;
    }

    // Normalize — but apply a noise floor so quiet recordings
    // don't get stretched to full height (the "flat block" bug).
    // If the peak is below 2% of full scale, cap the divisor
    // so the waveform stays proportionally small.
    const float NOISE_FLOOR = 0.02f;
    if (max_val > 0.0f) {
        float divisor = std::max(max_val, NOISE_FLOOR);
        for (float& val : waveform) {
            val = std::min(1.0f, val / divisor);
        }
    }

    return waveform;
}

static bool encode_flac(const std::vector<int16_t>& pcm_data, uint32_t sample_rate,
                        uint16_t channels, const std::string& output_path) {
    FLAC__StreamEncoder* encoder = FLAC__stream_encoder_new();
    if (!encoder) return false;

    FLAC__stream_encoder_set_channels(encoder, channels);
    FLAC__stream_encoder_set_bits_per_sample(encoder, 16);
    FLAC__stream_encoder_set_sample_rate(encoder, sample_rate);
    FLAC__stream_encoder_set_compression_level(encoder, 5); // Good balance of speed vs compression
    FLAC__stream_encoder_set_verify(encoder, false); // Skip verify for speed on mobile

    FLAC__StreamEncoderInitStatus init_status =
        FLAC__stream_encoder_init_file(encoder, output_path.c_str(), nullptr, nullptr);

    if (init_status != FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
        FLAC__stream_encoder_delete(encoder);
        return false;
    }

    // FLAC encoder expects FLAC__int32 samples, not int16_t
    // Process in chunks to avoid massive memory allocation
    const size_t CHUNK_FRAMES = 4096;
    const size_t total_samples = pcm_data.size();
    const size_t total_frames = total_samples / channels;
    std::vector<FLAC__int32> buffer(CHUNK_FRAMES * channels);

    size_t frames_processed = 0;
    bool ok = true;

    while (frames_processed < total_frames) {
        size_t frames_this_chunk = std::min(CHUNK_FRAMES, total_frames - frames_processed);
        size_t sample_offset = frames_processed * channels;

        for (size_t i = 0; i < frames_this_chunk * channels; ++i) {
            buffer[i] = (FLAC__int32)pcm_data[sample_offset + i];
        }

        if (!FLAC__stream_encoder_process_interleaved(encoder, buffer.data(), frames_this_chunk)) {
            ok = false;
            break;
        }
        frames_processed += frames_this_chunk;
    }

    FLAC__stream_encoder_finish(encoder);
    FLAC__stream_encoder_delete(encoder);
    return ok;
}

DecodeResult extract_audio_and_waveform(const std::string& input_path, const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;

    if (is_ogg_opus(input_path)) {
        // Decode using libopusfile
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000; // opusfile decodes to 48kHz
        out_channels = 1; // Force mono

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read < 0) break;
            if (samples_read == 0) break;
            pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + samples_read);
        }

        op_free(of);
    } else {
        // Decode using miniaudio (handles WAV, MP3, M4A, AAC, FLAC, WMA, etc.)
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio failed to initialize decoder: " + std::to_string(ma_res);
            return result;
        }

        out_sample_rate = decoder.outputSampleRate;
        out_channels = decoder.outputChannels;

        ma_uint64 total_frames = 0;
        ma_decoder_get_length_in_pcm_frames(&decoder, &total_frames);
        if (total_frames > 0) {
            pcm_data.reserve(total_frames * out_channels);
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * out_channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + frames_read * out_channels);
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    // Encode to FLAC
    if (!encode_flac(pcm_data, out_sample_rate, out_channels, output_path)) {
        result.error_message = "Failed to encode FLAC output.";
        return result;
    }

    // Calculate duration in ms
    result.duration_ms = (pcm_data.size() / out_channels) * 1000 / out_sample_rate;

    // Compute waveform
    result.waveform = compute_waveform(pcm_data);

    result.success = true;
    return result;
}

// ─── Memory-based decoder (for content:// → FLAC without temp file) ─────

struct MemStream {
    const uint8_t* data;
    size_t size;
    size_t pos;
};

static int mem_read(void* stream, unsigned char* ptr, int nbytes) {
    auto* ms = static_cast<MemStream*>(stream);
    int available = static_cast<int>(std::min<size_t>(nbytes, ms->size - ms->pos));
    if (available > 0) {
        std::memcpy(ptr, ms->data + ms->pos, available);
        ms->pos += available;
    }
    return available;
}

static int mem_seek(void* stream, opus_int64 offset, int whence) {
    auto* ms = static_cast<MemStream*>(stream);
    switch (whence) {
        case SEEK_SET:
            ms->pos = std::min<size_t>(static_cast<size_t>(offset), ms->size);
            break;
        case SEEK_CUR: {
            opus_int64 new_pos = static_cast<opus_int64>(ms->pos) + offset;
            ms->pos = std::min<size_t>(std::max<opus_int64>(0, new_pos), ms->size);
            break;
        }
        case SEEK_END:
            ms->pos = ms->size;
            break;
    }
    return 0;
}

static opus_int64 mem_tell(void* stream) {
    return static_cast<opus_int64>(static_cast<MemStream*>(stream)->pos);
}

static int mem_close(void* stream) {
    return 0;
}

DecodeResult extract_audio_and_waveform_from_memory(
    const uint8_t* data, size_t data_size, const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    if (!data || data_size == 0) {
        result.error_message = "Input data is null or empty.";
        return result;
    }

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;

    // Detect Ogg Opus via magic bytes
    bool is_opus = (data_size >= 4 &&
                    data[0] == 'O' && data[1] == 'g' &&
                    data[2] == 'g' && data[3] == 'S');

    if (is_opus) {
        // Decode opus from memory via custom callbacks
        MemStream ms = { data, data_size, 0 };
        OpusFileCallbacks callbacks = { mem_read, mem_seek, mem_tell, mem_close };

        int err = 0;
        OggOpusFile* of = op_open_callbacks(&ms, &callbacks, nullptr, 0, &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus from memory. Error: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000;
        out_channels = 1;

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read <= 0) break;
            pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + samples_read);
        }

        op_free(of);
    } else {
        // Use miniaudio from memory (auto-detects FLAC, WAV, MP3, M4A, etc.)
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_memory(data, data_size, &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio memory decoder failed: " + std::to_string(ma_res);
            return result;
        }

        out_sample_rate = decoder.outputSampleRate;
        out_channels = decoder.outputChannels;

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * out_channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + frames_read * out_channels);
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio from memory is empty.";
        return result;
    }

    // Encode to FLAC
    if (!encode_flac(pcm_data, out_sample_rate, out_channels, output_path)) {
        result.error_message = "Failed to encode FLAC from memory-decoded audio.";
        return result;
    }

    result.duration_ms = (pcm_data.size() / out_channels) * 1000 / out_sample_rate;
    result.waveform = compute_waveform(pcm_data);
    result.success = true;
    return result;
}

DecodeResult encode_pcm_to_flac(const int16_t* pcm_data, size_t num_samples,
                                uint32_t sample_rate, uint16_t channels,
                                const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    if (pcm_data == nullptr || num_samples == 0) {
        result.error_message = "PCM data is null or empty.";
        return result;
    }

    // Wrap raw pointer in a vector for reuse of existing helpers
    std::vector<int16_t> pcm_vec(pcm_data, pcm_data + num_samples);

    // Encode to FLAC
    if (!encode_flac(pcm_vec, sample_rate, channels, output_path)) {
        result.error_message = "Failed to encode FLAC from PCM data.";
        return result;
    }

    // Calculate duration
    result.duration_ms = (num_samples / channels) * 1000 / sample_rate;

    // Compute waveform
    result.waveform = compute_waveform(pcm_vec);

    result.success = true;
    return result;
}

// ─── FlacStreamEncoder (streaming AudioRecord → FLAC) ────────────────────

FlacStreamEncoder::FlacStreamEncoder(const std::string& output_path,
                                     uint32_t sample_rate,
                                     uint16_t channels,
                                     bool enable_dc_filter)
    : ok_(false)
    , encoder_(nullptr)
    , sample_rate_(sample_rate)
    , channels_(channels)
    , finalized_(false)
    , dc_filter_enabled_(enable_dc_filter)
    , dc_blocker_prev_in_(0.0)
    , dc_blocker_prev_out_(0.0)
{
    FLAC__StreamEncoder* enc = FLAC__stream_encoder_new();
    if (!enc) return;

    FLAC__stream_encoder_set_channels(enc, channels);
    FLAC__stream_encoder_set_bits_per_sample(enc, 16);
    FLAC__stream_encoder_set_sample_rate(enc, sample_rate);
    FLAC__stream_encoder_set_compression_level(enc, 5);
    FLAC__stream_encoder_set_verify(enc, false);

    FLAC__StreamEncoderInitStatus init_status =
        FLAC__stream_encoder_init_file(enc, output_path.c_str(), nullptr, nullptr);

    if (init_status != FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
        FLAC__stream_encoder_delete(enc);
        return;
    }

    encoder_ = enc;
    ok_ = true;
}

FlacStreamEncoder::~FlacStreamEncoder() {
    if (encoder_ && !finalized_) {
        auto* enc = static_cast<FLAC__StreamEncoder*>(encoder_);
        FLAC__stream_encoder_finish(enc);
        FLAC__stream_encoder_delete(enc);
        encoder_ = nullptr;
    }
}

bool FlacStreamEncoder::feed_pcm(const int16_t* data, size_t num_samples) {
    if (!ok_ || finalized_ || !encoder_) return false;

    // Apply DC-blocking high-pass filter (~80Hz cutoff at 16kHz) before
    // accumulation and encoding.  Removes subsonic rumble (wind,
    // handling noise, HVAC) without affecting speech frequencies.
    // Reuses dc_filter_scratch_ to avoid heap allocation per audio chunk.
    const int16_t* process_data = data;
    if (dc_filter_enabled_ && num_samples > 0) {
        dc_filter_scratch_.assign(data, data + num_samples);
        apply_dc_blocker(dc_filter_scratch_.data(), num_samples);
        process_data = dc_filter_scratch_.data();
    }

    // Accumulate PCM for waveform computation at finalize time
    pcm_accumulator_.insert(pcm_accumulator_.end(), process_data, process_data + num_samples);

    auto* enc = static_cast<FLAC__StreamEncoder*>(encoder_);
    const size_t total_frames = num_samples / channels_;
    const size_t CHUNK_FRAMES = 4096;

    // Ensure buffer is large enough; after first call capacity is correct → no realloc
    const size_t buffer_capacity = CHUNK_FRAMES * channels_;
    if (flac_buffer_.size() < buffer_capacity) {
        flac_buffer_.resize(buffer_capacity);
    }

    size_t frames_processed = 0;
    while (frames_processed < total_frames) {
        size_t frames = std::min(CHUNK_FRAMES, total_frames - frames_processed);
        size_t sample_offset = frames_processed * channels_;

        for (size_t i = 0; i < frames * channels_; ++i) {
            flac_buffer_[i] = static_cast<FLAC__int32>(process_data[sample_offset + i]);
        }

        if (!FLAC__stream_encoder_process_interleaved(enc, flac_buffer_.data(), frames)) {
            ok_ = false;
            return false;
        }
        frames_processed += frames;
    }

    return true;
}

void FlacStreamEncoder::apply_dc_blocker(int16_t* data, size_t num_samples) {
    // First-order high-pass: y[n] = x[n] - x[n-1] + R * y[n-1]
    // R = 0.995 gives ~13Hz cutoff at 16kHz, gentle roll-off below 80Hz
    // This removes DC offset and subsonic rumble while preserving speech.
    const double R = 0.995;
    double prev_in = dc_blocker_prev_in_;
    double prev_out = dc_blocker_prev_out_;

    for (size_t i = 0; i < num_samples; ++i) {
        double in = static_cast<double>(data[i]);
        double out = in - prev_in + R * prev_out;
        // Clamp to int16 range to avoid overflow
        data[i] = static_cast<int16_t>(std::max(-32768.0, std::min(32767.0, out)));
        prev_in = in;
        prev_out = out;
    }

    dc_blocker_prev_in_ = prev_in;
    dc_blocker_prev_out_ = prev_out;
}

DecodeResult FlacStreamEncoder::finalize() {
    DecodeResult result;
    result.success = false;

    if (!encoder_) {
        result.error_message = "Encoder not initialized.";
        return result;
    }

    if (finalized_) {
        result.error_message = "Encoder already finalized.";
        return result;
    }

    finalized_ = true;
    auto* enc = static_cast<FLAC__StreamEncoder*>(encoder_);

    FLAC__stream_encoder_finish(enc);
    FLAC__stream_encoder_delete(enc);
    encoder_ = nullptr;

    if (!pcm_accumulator_.empty()) {
        result.duration_ms = (pcm_accumulator_.size() / channels_) * 1000 / sample_rate_;
        result.waveform = compute_waveform(pcm_accumulator_);
    }

    result.success = true;
    return result;
}

} // namespace ekwe
