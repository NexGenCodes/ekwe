#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweCaptureController.h"
#include "../cpp/HybridEkweAudio.hpp"
#include <string>
#include <mutex>
#include <atomic>

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

    NSNumber *success = @(result.success);
    NSString *errorStr = [NSString stringWithUTF8String:result.error_message.c_str()];
    NSNumber *duration = @(result.duration_ms);

    NSMutableArray<NSNumber *> *waveformArray = [NSMutableArray arrayWithCapacity:result.waveform.size()];
    for (float val : result.waveform) {
        [waveformArray addObject:@(val)];
    }

    return @[success, errorStr, duration, waveformArray];
}

+ (NSArray *)decodeToWavWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::decode_audio_to_wav(input, output, static_cast<size_t>(maxAudioBytes));

    NSNumber *success = @(result.success);
    NSString *errorStr = [NSString stringWithUTF8String:result.error_message.c_str()];
    NSNumber *duration = @(result.duration_ms);

    NSMutableArray<NSNumber *> *waveformArray = [NSMutableArray arrayWithCapacity:result.waveform.size()];
    for (float val : result.waveform) {
        [waveformArray addObject:@(val)];
    }

    return @[success, errorStr, duration, waveformArray];
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

    // Recorded audio gets a sibling Opus-in-CAF file (same packets, CAF
    // container) so iOS can play it natively without a remux. Live mode has no
    // file output, so no CAF.
    std::string caf_path;
    if (!isLive) {
        caf_path = path;
        std::string::size_type pos = caf_path.rfind(".ogg");
        if (pos != std::string::npos) {
            caf_path.replace(pos, 4, ".caf");
        } else {
            caf_path += ".caf";
        }
    }

    auto* capture = new ekwe::CaptureController(
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        path,
        caf_path,
        mode,
        true
    );

    if (capture && capture->is_ok()) {
        capture->set_callback([packetBlock, silenceBlock](const ekwe::CaptureEventData& event) {
            switch (event.event) {
                case ekwe::CaptureEvent::AUDIO_DATA:
                    // Nitro path — zero-copy ArrayBuffer dispatch
                    if (!event.data.empty()) {
                        margelo::nitro::ekwe::HybridEkweAudio::dispatchOpusPacket(
                            event.data.data(), event.data.size(), event.rms);
                    }
                    // Legacy Expo event path (backward compat)
                    if (packetBlock && !event.data.empty()) {
                        NSData *packet = [NSData dataWithBytes:event.data.data()
                                                        length:event.data.size()];
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
        // Tear down the controller while holding the mutex: stop(), the final
        // waveform read, and the delete all touch the object no other thread can
        // reach now that g_capture was nulled above. This keeps g_last_waveform
        // writes fully synchronized with the lastWaveform() reader.
        capture->stop();
        g_last_waveform = capture->get_waveform(60);
        delete capture;
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
