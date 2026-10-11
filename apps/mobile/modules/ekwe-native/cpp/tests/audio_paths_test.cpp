// Covers the decoder entry points the iOS bridges delegate to but that cannot
// be exercised on a device in this repo: container classification, the Ogg->WAV
// bridge AVFoundation reads for M4A playback, duration probing, and the
// memory/PCM encode paths.
// Build and run with cpp/tests/run-tests.sh.
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
    std::printf("  %-56s %s\n", name, ok ? "PASS" : "FAIL");
    if (!ok) ++g_failures;
}

// Opus rounds to 20 ms frames around a pre-skip, so a re-encoded 1 s tone
// comes back a few milliseconds short; exact equality would be a false alarm.
bool near_1000(int ms) { return std::abs(ms - 1000) <= 50; }

std::string temp_path(const char* name) {
    const char* dir = std::getenv("TMPDIR");
    return std::string(dir && *dir ? dir : "/tmp") + "/ekwe_paths_" + name;
}

std::vector<int16_t> tone(size_t frames) {
    std::vector<int16_t> pcm(frames);
    for (size_t i = 0; i < frames; ++i) {
        double t = static_cast<double>(i) / SR;
        pcm[i] = static_cast<int16_t>(0.6 * 22000.0 * std::sin(2.0 * M_PI * 220.0 * t));
    }
    return pcm;
}

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
    put16(20, 1);
    put16(22, 1);
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

// Builds the three fixture containers once so the classification and decode
// checks all run against real bytes rather than hand-written headers.
struct Fixtures {
    std::string wav;
    std::string opus;
    std::string vorbis;
};

Fixtures make_fixtures() {
    Fixtures fx;
    fx.wav = temp_path("src.wav");
    fx.opus = temp_path("src_opus.ogg");
    fx.vorbis = temp_path("src_vorbis.ogg");

    std::vector<int16_t> pcm = tone(SR);
    write_wav(fx.wav, pcm);
    encode_pcm_to_opus(pcm.data(), pcm.size(), SR, 1, fx.opus, 20);
    encode_pcm_to_vorbis(fx.vorbis, pcm.data(), pcm.size(), SR, 1);
    return fx;
}

void test_classify(const Fixtures& fx) {
    check("classify: WAV is not Ogg",
          classify_audio_container(fx.wav) == AudioContainer::kNotOgg);
    check("classify: Ogg Opus detected",
          classify_audio_container(fx.opus) == AudioContainer::kOggOpus);
    check("classify: Ogg Vorbis detected",
          classify_audio_container(fx.vorbis) == AudioContainer::kOggVorbis);
    check("classify: missing file is not Ogg",
          classify_audio_container("<nonexistent>") == AudioContainer::kNotOgg);
}

void test_decode_audio_to_wav(const Fixtures& fx) {
    const std::string out = temp_path("bridge.wav");
    std::remove(out.c_str());

    DecodeResult r = decode_audio_to_wav(fx.opus, out);
    check("bridge: Ogg Opus decodes to WAV", r.success);
    check("bridge: reports ~1000 ms", near_1000(r.duration_ms));

    std::vector<uint8_t> bytes;
    check("bridge: WAV readable", read_all(out, bytes));
    check("bridge: is RIFF/WAVE",
          bytes.size() >= 12 && std::memcmp(bytes.data(), "RIFF", 4) == 0 &&
              std::memcmp(bytes.data() + 8, "WAVE", 4) == 0);

    // AVFoundation opens the bridge with the platform decoder, but the module's
    // own reader is the closest host approximation that it is well-formed.
    DecodeResult back = analyze_audio_file(out);
    check("bridge: WAV decodes back", back.success && near_1000(back.duration_ms));
}

void test_probe(const Fixtures& fx) {
    check("probe: WAV reports 1000 ms", probe_audio_duration_ms(fx.wav) == 1000);
    check("probe: Ogg Opus reports ~1000 ms", near_1000(probe_audio_duration_ms(fx.opus)));
    check("probe: missing file is -1", probe_audio_duration_ms("<nonexistent>") == -1);
}

void test_encode_pcm_to_opus() {
    const std::string out = temp_path("pcm_opus.ogg");
    std::remove(out.c_str());

    std::vector<int16_t> pcm = tone(SR);
    DecodeResult r = encode_pcm_to_opus(pcm.data(), pcm.size(), SR, 1, out, 20);
    check("encode_pcm_to_opus: succeeds", r.success);
    check("encode_pcm_to_opus: reports 1000 ms", r.duration_ms == 1000);

    std::vector<uint8_t> bytes;
    read_all(out, bytes);
    check("encode_pcm_to_opus: output is Ogg Opus", contains(bytes, "OpusHead"));
}

void test_transcode_from_memory(const Fixtures& fx) {
    const std::string out = temp_path("memory_opus.ogg");
    std::remove(out.c_str());

    std::vector<uint8_t> wav_bytes;
    if (!read_all(fx.wav, wav_bytes)) {
        check("from_memory: WAV fixture readable", false);
        return;
    }
    DecodeResult r = transcode_audio_to_opus_from_memory(
        wav_bytes.data(), wav_bytes.size(), out, kDefaultMaxAudioBytes, 20);
    check("from_memory: WAV in memory transcodes", r.success);
    check("from_memory: reports 1000 ms", r.duration_ms == 1000);

    std::vector<uint8_t> bytes;
    read_all(out, bytes);
    check("from_memory: output is Ogg Opus", contains(bytes, "OpusHead"));
}

} // namespace

int main() {
    Fixtures fx = make_fixtures();

    test_classify(fx);
    test_decode_audio_to_wav(fx);
    test_probe(fx);
    test_encode_pcm_to_opus();
    test_transcode_from_memory(fx);

    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
