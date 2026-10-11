// Tests for the Vorbis-in-Ogg encoder the Wit.ai upload path depends on.
// Build and run with cpp/tests/run-tests.sh.
//
// Wit.ai parses Vorbis but not Opus, so a wrong container here is silent: the
// API answers 200 with an empty transcript instead of an error. The checks
// below therefore assert on the actual bytes written, not just that the call
// reported success.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "EkweAudioDecoder.h"
#include "EkweVorbisEncoder.h"

using namespace ekwe;

namespace {

const uint32_t SR = 16000;

int g_failures = 0;
int g_checks = 0;

void check(const char* name, bool ok) {
    ++g_checks;
    std::printf("  %-52s %s\n", name, ok ? "PASS" : "FAIL");
    if (!ok) ++g_failures;
}

std::string temp_path(const char* name) {
    const char* dir = std::getenv("TMPDIR");
    return std::string(dir && *dir ? dir : "/tmp") + "/ekwe_vorbis_" + name;
}

std::vector<int16_t> tone(size_t frames) {
    std::vector<int16_t> pcm(frames);
    for (size_t i = 0; i < frames; ++i) {
        double t = static_cast<double>(i) / SR;
        // Two partials plus a slow envelope: a pure sine compresses so well
        // that a bitrate assertion on it would prove nothing.
        double env = 0.5 * std::sin(2.0 * M_PI * 1.7 * t) + 0.5;
        double s = env * (0.6 * std::sin(2.0 * M_PI * 180.0 * t) +
                          0.3 * std::sin(2.0 * M_PI * 700.0 * t));
        pcm[i] = static_cast<int16_t>(s * 22000.0);
    }
    return pcm;
}

// -1 when the file does not exist.
long file_size(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return -1;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fclose(f);
    return n;
}

bool read_all(const std::string& path, std::vector<uint8_t>& out) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n < 0) {
        std::fclose(f);
        return false;
    }
    out.resize(static_cast<size_t>(n));
    size_t got = n > 0 ? std::fread(out.data(), 1, out.size(), f) : 0;
    std::fclose(f);
    return got == out.size();
}

bool contains(const std::vector<uint8_t>& hay, const char* needle) {
    const size_t n = std::strlen(needle);
    if (hay.size() < n) return false;
    for (size_t i = 0; i + n <= hay.size(); ++i) {
        if (std::memcmp(hay.data() + i, needle, n) == 0) return true;
    }
    return false;
}

// Minimal 16-bit mono PCM WAV, so the file-based entry point has an input
// that is not already Ogg.
bool write_wav(const std::string& path, const std::vector<int16_t>& pcm) {
    const uint32_t data_size = static_cast<uint32_t>(pcm.size() * 2);
    std::vector<uint8_t> buf(44 + data_size);
    auto put32 = [&](size_t o, uint32_t v) {
        buf[o] = static_cast<uint8_t>(v & 0xff);
        buf[o + 1] = static_cast<uint8_t>((v >> 8) & 0xff);
        buf[o + 2] = static_cast<uint8_t>((v >> 16) & 0xff);
        buf[o + 3] = static_cast<uint8_t>((v >> 24) & 0xff);
    };
    auto put16 = [&](size_t o, uint16_t v) {
        buf[o] = static_cast<uint8_t>(v & 0xff);
        buf[o + 1] = static_cast<uint8_t>((v >> 8) & 0xff);
    };
    std::memcpy(buf.data(), "RIFF", 4);
    put32(4, 36 + data_size);
    std::memcpy(buf.data() + 8, "WAVE", 4);
    std::memcpy(buf.data() + 12, "fmt ", 4);
    put32(16, 16);
    put16(20, 1);              // PCM
    put16(22, 1);              // mono
    put32(24, SR);
    put32(28, SR * 2);
    put16(32, 2);
    put16(34, 16);
    std::memcpy(buf.data() + 36, "data", 4);
    put32(40, data_size);
    std::memcpy(buf.data() + 44, pcm.data(), data_size);

    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    size_t wrote = std::fwrite(buf.data(), 1, buf.size(), f);
    std::fclose(f);
    return wrote == buf.size();
}

void test_writes_a_vorbis_ogg() {
    const std::string path = temp_path("encode.ogg");
    std::remove(path.c_str());

    const std::vector<int16_t> pcm = tone(SR); // 1s
    DecodeResult r = encode_pcm_to_vorbis(path, pcm.data(), pcm.size(), SR, 1);

    check("encode_pcm_to_vorbis succeeds", r.success);
    if (!r.success) {
        std::printf("      error=%s\n", r.error_message.c_str());
        return;
    }
    check("reports a 1000 ms duration", r.duration_ms == 1000);
    check("returns the 60-bin waveform", r.waveform.size() == 60);

    std::vector<uint8_t> bytes;
    check("output file exists and is readable", read_all(path, bytes));
    check("output starts with an Ogg page",
          bytes.size() >= 4 && std::memcmp(bytes.data(), "OggS", 4) == 0);
    check("first packet is a Vorbis identification header",
          contains(bytes, "\x01vorbis"));
    check("carries no OpusHead", !contains(bytes, "OpusHead"));
    check("output is not empty", bytes.size() > 1024);

    // The point of the whole exercise: the bytes that reach Wit.ai have to
    // decode back with the duration and waveform the bridge promises.
    DecodeResult back = analyze_audio_file(path);
    check("the encoded file decodes back", back.success);
    if (back.success) {
        check("duration survives the round trip",
              back.duration_ms >= 980 && back.duration_ms <= 1020);
        check("waveform survives the round trip", back.waveform.size() == 60);
    } else {
        std::printf("      error=%s\n", back.error_message.c_str());
    }
}

void test_pcm_contract_is_enforced() {
    const std::string path = temp_path("contract.ogg");
    std::remove(path.c_str());
    std::vector<int16_t> pcm = tone(SR);

    DecodeResult empty =
        encode_pcm_to_vorbis(path, pcm.data(), 0, SR, 1);
    check("zero samples are rejected", !empty.success);
    check("zero samples report the PCM error",
          empty.error_message == "PCM data is null or empty.");

    DecodeResult nul = encode_pcm_to_vorbis(path, nullptr, SR, SR, 1);
    check("null PCM is rejected", !nul.success);
    check("null PCM reports the PCM error",
          nul.error_message == "PCM data is null or empty.");

    DecodeResult bad_rate =
        encode_pcm_to_vorbis(path, pcm.data(), pcm.size(), 0, 1);
    check("zero sample rate is rejected", !bad_rate.success);
    check("zero sample rate reports the channel/rate error",
          bad_rate.error_message == "channels and sample_rate must be positive.");

    // Past the shared 30 minute ceiling, which is measured in time rather
    // than sample count so a source at an unusual rate cannot slip under it.
    // The rate here is the lever: 32000 samples at 8 Hz is over an hour of
    // audio, and the ceiling trips before anything is resampled or encoded.
    const std::vector<int16_t> short_pcm = tone(32000);
    DecodeResult too_long =
        encode_pcm_to_vorbis(path, short_pcm.data(), short_pcm.size(), 8, 1);
    check("audio over the duration ceiling is rejected", !too_long.success);
    check("audio over the ceiling reports AUDIO_TOO_LONG",
          too_long.error_message == "AUDIO_TOO_LONG");
}

void test_file_entry_point() {
    const std::string wav = temp_path("source.wav");
    const std::string ogg = temp_path("transcoded.ogg");
    std::remove(ogg.c_str());

    const std::vector<int16_t> pcm = tone(SR * 2); // 2s
    check("source WAV written", write_wav(wav, pcm));

    DecodeResult r =
        transcode_audio_to_vorbis(wav, ogg, 10 * 1024 * 1024);
    check("WAV transcodes to Vorbis", r.success);
    if (!r.success) {
        std::printf("      error=%s\n", r.error_message.c_str());
        return;
    }
    check("transcode reports a 2000 ms duration", r.duration_ms == 2000);

    std::vector<uint8_t> bytes;
    check("transcoded file is readable", read_all(ogg, bytes));
    check("transcoded file is Vorbis", contains(bytes, "\x01vorbis"));

    // The size guard runs before any decode, so a bomb never reaches the
    // decoder regardless of the codec it claims to be — and nothing is left
    // behind for a caller to mistake for a converted file.
    const std::string never = temp_path("oversized.ogg");
    std::remove(never.c_str());
    DecodeResult too_big = transcode_audio_to_vorbis(wav, never, 1024);
    check("oversized input is rejected", !too_big.success);
    check("oversized input reports FILE_TOO_LARGE",
          too_big.error_message == "FILE_TOO_LARGE");
    check("oversized input writes no output", file_size(never) < 0);
}

// Every entry point below builds a DecodeResult, sets error_message on the
// failure paths, and returns without touching success or duration_ms. Callers
// read both, so the members have to carry a failed state by default.
void test_default_result_is_a_failure() {
    DecodeResult fresh;
    check("a default result is a failure", !fresh.success);
    check("a default result reports no duration", fresh.duration_ms == 0);
    check("a default result has no error", fresh.error_message.empty());

    DualTranscodeResult both;
    check("a default dual result fails on both codecs",
          !both.opus.success && !both.vorbis.success);

    const std::string opus_out = temp_path("default_opus.ogg");
    const std::string vorbis_out = temp_path("default_vorbis.ogg");
    std::remove(opus_out.c_str());
    std::remove(vorbis_out.c_str());

    DualTranscodeResult rejected =
        transcode_audio_to_dual("<nonexistent>", opus_out, vorbis_out, 1024);
    check("a missing source fails the opus half", !rejected.opus.success);
    check("a missing source fails the vorbis half", !rejected.vorbis.success);
    check("a missing source reports an error on both halves",
          !rejected.opus.error_message.empty() &&
              !rejected.vorbis.error_message.empty());
    check("a missing source writes no opus output", file_size(opus_out) < 0);
    check("a missing source writes no vorbis output", file_size(vorbis_out) < 0);
}

} // namespace

int main() {
    test_writes_a_vorbis_ogg();
    test_pcm_contract_is_enforced();
    test_file_entry_point();
    test_default_result_is_a_failure();

    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
