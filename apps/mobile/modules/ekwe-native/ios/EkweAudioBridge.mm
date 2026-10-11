#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweCaptureController.h"
#include "../cpp/HybridEkweAudio.hpp"
#include <string>
#include <vector>
#include <utility>
#include <mutex>
#include <atomic>

static NSArray *resultArray(const ekwe::DecodeResult &result) {
    NSArray<NSNumber *> *waveformArray = [NSArray array];
    if (!result.waveform.empty()) {
        NSMutableArray<NSNumber *> *w = [NSMutableArray arrayWithCapacity:result.waveform.size()];
        for (float val : result.waveform) {
            [w addObject:@(val)];
        }
        waveformArray = w;
    }
    return @[@(result.success),
             [NSString stringWithUTF8String:result.error_message.c_str()],
             @(result.duration_ms),
             waveformArray];
}

static std::mutex g_mutex;
static std::atomic<float> g_current_rms{0.0f};
static ekwe::CaptureController* g_capture = nullptr;
static OpusPacketCallback g_opusPacketBlock = nil;
static VadSilenceCallback g_vadSilenceBlock = nil;
static std::vector<float> g_last_waveform;

// Accessor for HybridEkweAudio — reads the platform's g_current_rms atomic
namespace ekwe {
    float get_current_rms() {
        return g_current_rms.load(std::memory_order_relaxed);
    }
}

@implementation EkweAudioBridge

+ (NSArray *)transcodeToOpusWithWaveform:(NSString *)sourcePath outputPath:(NSString *)outputPath {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::transcode_audio_to_opus(input, output);
    return resultArray(result);
}

+ (NSArray *)transcodeToVorbisWithWaveform:(NSString *)sourcePath
                                outputPath:(NSString *)outputPath
                             maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result =
        ekwe::transcode_audio_to_vorbis(input, output, static_cast<size_t>(maxAudioBytes));
    return resultArray(result);
}

+ (NSArray *)decodeToWavWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::decode_audio_to_wav(input, output, static_cast<size_t>(maxAudioBytes));
    return resultArray(result);
}

+ (NSArray *)transcodeToDualWithWaveform:(NSString *)sourcePath
                             opusOutputPath:(NSString *)opusOutputPath
                          vorbisOutputPath:(NSString *)vorbisOutputPath
                             maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string opus_output([opusOutputPath UTF8String]);
    std::string vorbis_output([vorbisOutputPath UTF8String]);

    ekwe::DualTranscodeResult result = ekwe::transcode_audio_to_dual(
        input, opus_output, vorbis_output, static_cast<size_t>(maxAudioBytes));

    return @[resultArray(result.opus), resultArray(result.vorbis)];
}

+ (NSInteger)probeAudioDurationMs:(NSString *)path {
    return ekwe::probe_audio_duration_ms(std::string([path UTF8String]));
}

+ (NSArray *)remuxToCafWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::remux_audio_to_caf(input, output, static_cast<size_t>(maxAudioBytes));

    NSNumber *success = @(result.success);
    NSString *errorStr = [NSString stringWithUTF8String:result.error_message.c_str()];
    NSNumber *duration = @(result.duration_ms);

    NSMutableArray<NSNumber *> *waveformArray = [NSMutableArray arrayWithCapacity:result.waveform.size()];
    for (float val : result.waveform) {
        [waveformArray addObject:@(val)];
    }

    return @[success, errorStr, duration, waveformArray];
}

+ (BOOL)initCapture:(NSString *)outputPath
         sampleRate:(int32_t)sampleRate
           channels:(int32_t)channels
             isLive:(BOOL)isLive
    opusPacketBlock:(OpusPacketCallback)opusPacketBlock
    vadSilenceBlock:(VadSilenceCallback)vadSilenceBlock {

    OpusPacketCallback packetBlock = [opusPacketBlock copy];
    VadSilenceCallback silenceBlock = [vadSilenceBlock copy];

    std::string path([outputPath UTF8String]);
    ekwe::CaptureMode mode = isLive ? ekwe::CaptureMode::LIVE : ekwe::CaptureMode::FILE;

    // One recorded artifact: the Ogg Opus file. The Opus-in-CAF copy that iOS
    // needs for native playback is derived on demand at play time
    // (remux_audio_to_caf) and cached alongside it, so capture does not pay to
    // write every packet twice and no sibling file is orphaned on crash.
    auto* capture = new ekwe::CaptureController(
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        path,
        mode,
        true
    );

    if (capture && capture->is_ok()) {
        capture->set_callback([packetBlock, silenceBlock](const ekwe::CaptureEventData& event) {
            switch (event.event) {
                case ekwe::CaptureEvent::AUDIO_DATA:
                    // Nitro path — zero-copy ArrayBuffer dispatch
                    if (event.data.size > 0) {
                        margelo::nitro::ekwe::HybridEkweAudio::dispatchOpusPacket(
                            event.data.data, event.data.size, event.rms);
                    }
                    // Legacy Expo event path (backward compat)
                    if (packetBlock && event.data.size > 0) {
                        NSData *packet = [NSData dataWithBytes:event.data.data
                                                        length:event.data.size];
                        packetBlock(packet, event.rms);
                    }
                    break;
                case ekwe::CaptureEvent::VAD_SILENCE:
                    // Nitro path
                    margelo::nitro::ekwe::HybridEkweAudio::dispatchVadSilence();
                    // Legacy Expo event path (backward compat)
                    if (silenceBlock) {
                        silenceBlock();
                    }
                    break;
                default:
                    break;
            }
        });

        std::lock_guard<std::mutex> lock(g_mutex);
        if (g_capture) {
            delete g_capture;
        }
        g_capture = capture;
        g_opusPacketBlock = packetBlock;
        g_vadSilenceBlock = silenceBlock;
        g_current_rms.store(0.0f, std::memory_order_relaxed);
        return YES;
    }

    delete capture;
    return NO;
}

+ (BOOL)feedPcm:(int16_t *)pcmData numSamples:(int32_t)numSamples {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_capture) return NO;
    bool ok = g_capture->feed_pcm(pcmData, static_cast<size_t>(numSamples));
    g_current_rms.store(g_capture->rms(), std::memory_order_relaxed);
    return ok ? YES : NO;
}

+ (BOOL)feedPcmFloat:(float *)pcmData numSamples:(int32_t)numSamples {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_capture) return NO;
    bool ok = g_capture->feed_pcm_float(pcmData, static_cast<size_t>(numSamples));
    g_current_rms.store(g_capture->rms(), std::memory_order_relaxed);
    return ok ? YES : NO;
}

+ (BOOL)stopCapture {
    ekwe::CaptureController* capture;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (!g_capture) return NO;
        capture = g_capture;
        g_capture = nullptr;
        g_opusPacketBlock = nil;
        g_vadSilenceBlock = nil;
    }

    // Deliberately outside g_mutex: stop() now re-decodes the finished Ogg to
    // derive the waveform, which is disk I/O plus a full decode. Holding the
    // global lock across that would stall amplitude polling and every other
    // bridge call for the duration. This is safe because g_capture was already
    // nulled above, so no other thread can reach the controller — the object is
    // exclusively owned from here until the delete.
    capture->stop();
    std::vector<float> waveform = capture->waveform();
    delete capture;

    {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_last_waveform = std::move(waveform);
        g_current_rms.store(0.0f, std::memory_order_relaxed);
    }
    return YES;
}

+ (NSArray<NSNumber *> *)lastWaveform {
    std::lock_guard<std::mutex> lock(g_mutex);
    NSMutableArray<NSNumber *> *arr = [NSMutableArray arrayWithCapacity:g_last_waveform.size()];
    for (float v : g_last_waveform) {
        [arr addObject:@(v)];
    }
    g_last_waveform.clear();
    return arr;
}

+ (float)getAmplitude {
    return g_current_rms.load(std::memory_order_relaxed);
}

@end
