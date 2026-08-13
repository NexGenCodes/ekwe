#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweCaptureController.h"
#include <string>
#include <mutex>

static std::mutex g_mutex;
static ekwe::CaptureController* g_capture = nullptr;
static OpusPacketCallback g_opusPacketBlock = nil;
static VadSilenceCallback g_vadSilenceBlock = nil;
static std::vector<float> g_last_waveform;

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
                    if (packetBlock && !event.data.empty()) {
                        NSData *packet = [NSData dataWithBytes:event.data.data()
                                                        length:event.data.size()];
                        packetBlock(packet, event.rms);
                    }
                    break;
                case ekwe::CaptureEvent::VAD_SILENCE:
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
        return YES;
    }

    delete capture;
    return NO;
}

+ (BOOL)feedPcm:(int16_t *)pcmData numSamples:(int32_t)numSamples {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_capture) return NO;
    return g_capture->feed_pcm(pcmData, static_cast<size_t>(numSamples)) ? YES : NO;
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
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_capture) return 0.0f;
    return g_capture->rms();
}

@end
