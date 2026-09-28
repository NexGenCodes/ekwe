// Regression tests for the FILE-mode leading-silence gate in
// EkweCaptureController. Build and run with cpp/tests/run-tests.sh.
//
// These drive the real controller and compare the size of the Ogg it writes
// against a speech-only take of the same audio, so the assertions measure the
// bytes actually kept rather than trusting internal counters.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "EkweCaptureController.h"

using namespace ekwe;

namespace {

const uint32_t SR = 16000;
const size_t FRAME = 320; // 20ms at 16 kHz mono

int g_failures = 0;
int g_checks = 0;

void check(const char* name, bool ok) {
    ++g_checks;
    std::printf("  %-52s %s\n", name, ok ? "PASS" : "FAIL");
    if (!ok) ++g_failures;
}

// feed_pcm clips a single call that exceeds the staging buffer, so audio goes
// in one 20ms frame at a time, the way the platform callback delivers it.
void feed(CaptureController& c, const std::vector<int16_t>& pcm) {
    for (size_t i = 0; i + FRAME <= pcm.size(); i += FRAME) {
        if (!c.feed_pcm(pcm.data() + i, FRAME)) break;
    }
}

std::vector<int16_t> speech(int n_frames) {
    std::vector<int16_t> out;
    for (int f = 0; f < n_frames; ++f) {
        for (size_t i = 0; i < FRAME; ++i) {
            out.push_back(static_cast<int16_t>(
                9000.0 * std::sin(2.0 * M_PI * 220.0 * i / SR)));
        }
    }
    return out;
}

std::vector<int16_t> silence(int n_frames) {
    return std::vector<int16_t>(FRAME * n_frames, 0);
}

long file_size(const std::string& p) {
    FILE* f = std::fopen(p.c_str(), "rb");
    if (!f) return -1;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fclose(f);
    return n;
}

std::string temp_path(const char* name) {
    const char* dir = std::getenv("TMPDIR");
    return std::string(dir && *dir ? dir : "/tmp") + "/ekwe_gate_" + name;
}

// Writes 1s of speech with the gate idle (speech on the first frame), giving
// every other test a baseline to compare against.
long speech_only_size() {
    const std::string out = temp_path("alone.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, speech(50));
    c.stop();
    return file_size(out);
}

void test_drops_leading_silence() {
    // 1s of silence then 1s of speech. The gate must not encode the silence,
    // but must keep enough pre-roll for the onset of the first syllable.
    const std::string out = temp_path("trim.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, silence(50));
    feed(c, speech(50));
    c.stop();

    const long trimmed = file_size(out);
    const long alone = speech_only_size();
    std::printf("    trimmed=%ld alone=%ld ratio=%.2f\n", trimmed, alone,
                alone > 0 ? (double)trimmed / (double)alone : 0.0);

    check("writes a non-empty Ogg", trimmed > 0);
    check("keeps the onset (not far below speech-only)", trimmed > alone * 8 / 10);
    // Speech plus at most kPrerollMs of held silence. Silence encodes to about
    // 8 bytes a packet, so its share of the bytes is well under its half of the
    // duration; an ungated take of the same audio would be roughly 2x.
    check("holds no more than the 500ms pre-roll", trimmed < alone * 13 / 10);
}

void test_speech_from_the_first_frame_is_untouched() {
    const std::string out = temp_path("onset.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, speech(50));
    c.stop();
    check("a take that opens on speech matches the baseline",
          file_size(out) == speech_only_size());
}

void test_never_speaks_still_writes_a_valid_file() {
    // Past the kLeadInMaxMs bound the gate stops waiting, so the artifact is
    // real audio rather than an Ogg with no packets.
    const std::string out = temp_path("silent.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, silence(150));
    c.stop();
    check("a silent take still produced a non-empty Ogg", file_size(out) > 0);
}

void test_stop_inside_the_lead_in_is_rescued() {
    // stop() has to flush the ring, otherwise this finalizes an empty Ogg that
    // iOS cannot remux.
    const std::string out = temp_path("early.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, silence(10));
    c.stop();
    check("an early stop still produced a non-empty Ogg", file_size(out) > 0);
}

void test_late_speech_discards_the_older_silence() {
    // 3s of lead-in exceeds the 2s bound, so the oldest silence is dropped
    // rather than the whole take waiting forever.
    const std::string out = temp_path("late.ogg");
    std::remove(out.c_str());
    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    feed(c, silence(150));
    feed(c, speech(50));
    c.stop();

    const long late = file_size(out);
    const long alone = speech_only_size();
    check("late speech is still recorded", late > 0);
    check("the full 3s lead-in was not encoded", late < alone * 4);
}

// A call larger than the 8192-sample staging buffer used to be clipped, so the
// remainder was dropped and the recording silently lost audio. Feeding the same
// audio in one call must now produce the same file as feeding it in chunks.
void test_oversized_feed_is_not_truncated() {
    const std::string chunked = temp_path("big_chunked.ogg");
    const std::string whole = temp_path("big_whole.ogg");
    std::remove(chunked.c_str());
    std::remove(whole.c_str());

    const std::vector<int16_t> pcm = speech(150); // 3s, 48000 samples

    CaptureController a(SR, 1, chunked, CaptureMode::FILE, false);
    feed(a, pcm);
    a.stop();

    CaptureController b(SR, 1, whole, CaptureMode::FILE, false);
    b.feed_pcm(pcm.data(), pcm.size()); // one oversized call
    b.stop();

    const long one = file_size(chunked);
    const long two = file_size(whole);
    std::printf("    chunked=%ld single_call=%ld (staging buffer is 8192)\n",
                one, two);
    check("an oversized feed is not truncated", two == one);
    check("a 3s take actually got written", one > 0);
}

void test_ragged_feed_lands_on_frame_boundaries() {
    // A trailing partial frame is zero-padded by stop(), so a feed that does
    // not divide evenly must still produce a decodable file.
    const std::string out = temp_path("ragged.ogg");
    std::remove(out.c_str());
    std::vector<int16_t> pcm = speech(50);
    pcm.resize(pcm.size() - 37); // deliberately not frame-aligned

    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    c.feed_pcm(pcm.data(), pcm.size());
    c.stop();

    check("a ragged final frame still writes a valid Ogg", file_size(out) > 0);
}

// stop() used to zero-pad the trailing partial frame in place, which wrote past
// the end of staging_buffer_ whenever a call filled the buffer and left a
// partial frame behind. ASan flags it as a stack-buffer-overflow; without a
// sanitizer it is a silent heap corruption on a normal stop.
void test_stop_padding_does_not_overflow_the_staging_buffer() {
    // 25 frames is 8000 samples, just under the 8192 capacity, so the buffer is
    // full-ish and the remainder is a partial frame.
    const size_t extras[] = {1, 7, 63, 199, 319};
    for (size_t extra : extras) {
        std::vector<int16_t> pcm(FRAME * 25 + extra);
        for (size_t i = 0; i < pcm.size(); ++i) {
            pcm[i] = static_cast<int16_t>(
                9000.0 * std::sin(2.0 * M_PI * 220.0 * i / SR));
        }

        const std::string out = temp_path("pad.ogg");
        std::remove(out.c_str());
        CaptureController c(SR, 1, out, CaptureMode::FILE, false);
        c.feed_pcm(pcm.data(), pcm.size()); // one oversized call
        c.stop();

        char label[96];
        std::snprintf(label, sizeof(label),
                      "stop() with a %zu-sample tail does not overflow", extra);
        check(label, file_size(out) > 0);
    }
}

// The same overflow is reachable when the buffer is filled exactly and the next
// call leaves a partial frame, which is the shape a platform callback produces.
void test_stop_padding_after_an_exact_fill() {
    const std::string out = temp_path("pad_exact.ogg");
    std::remove(out.c_str());

    CaptureController c(SR, 1, out, CaptureMode::FILE, false);
    // 8192 samples fills the staging buffer exactly with a partial frame left
    // over (8192 is not a multiple of 320).
    std::vector<int16_t> fill(8192, 3000);
    c.feed_pcm(fill.data(), fill.size());
    std::vector<int16_t> more(101, 3000);
    c.feed_pcm(more.data(), more.size());
    c.stop();

    check("stop() after an exact fill does not overflow", file_size(out) > 0);
}

void test_live_mode_forwards_every_frame() {
    // LIVE carries raw PCM to the worker and must not be gated at all: the
    // worker relies on the full signal, silence included.
    const std::string out = temp_path("live.ogg");
    std::remove(out.c_str());
    int audio_frames = 0;
    CaptureController c(SR, 1, out, CaptureMode::LIVE, false);
    c.set_callback([&](const CaptureEventData& e) {
        if (e.event == CaptureEvent::AUDIO_DATA) ++audio_frames;
    });
    feed(c, silence(50));
    feed(c, speech(20));
    c.stop();
    std::printf("    live frames forwarded=%d (expected 70)\n", audio_frames);
    check("LIVE forwards silence as well as speech", audio_frames == 70);
}

} // namespace

int main() {
    test_drops_leading_silence();
    test_speech_from_the_first_frame_is_untouched();
    test_never_speaks_still_writes_a_valid_file();
    test_stop_inside_the_lead_in_is_rescued();
    test_late_speech_discards_the_older_silence();
    test_oversized_feed_is_not_truncated();
    test_ragged_feed_lands_on_frame_boundaries();
    test_stop_padding_does_not_overflow_the_staging_buffer();
    test_stop_padding_after_an_exact_fill();
    test_live_mode_forwards_every_frame();

    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
