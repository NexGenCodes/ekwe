#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweCaptureController.h"
#include <string>

static ekwe::CaptureController* g_capture = nullptr;
static OpusPacketCallback g_opusPacketBlock = nil;
static VadSilenceCallback g_vadSilenceBlock = nil;
static std::vector<float> g_last_waveform;

@implementation EkweAudioBridge

+ (NSArray *)extractWavAndWaveform:(NSString *)sourcePath outputPath:(NSString *)outputPath {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::extract_audio_and_waveform(input, output);

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

    if (g_capture) {
        delete g_capture;
        g_capture = nullptr;
    }

    // Store callbacks
    g_opusPacketBlock = [opusPacketBlock copy];
    g_vadSilenceBlock = [vadSilenceBlock copy];

    std::string path([outputPath UTF8String]);
    ekwe::CaptureMode mode = isLive ? ekwe::CaptureMode::LIVE : ekwe::CaptureMode::FILE;

    g_capture = new ekwe::CaptureController(
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        path,
        mode,
        true
    );

    if (g_capture && g_capture->is_ok()) {
        g_capture->set_callback([](const ekwe::CaptureEventData& event) {
            switch (event.event) {
                case ekwe::CaptureEvent::AUDIO_DATA:
                    if (g_opusPacketBlock && !event.data.empty()) {
                        NSData *packet = [NSData dataWithBytes:event.data.data()
                                                        length:event.data.size()];
                        g_opusPacketBlock(packet, event.rms);
                    }
                    break;
                case ekwe::CaptureEvent::VAD_SILENCE:
                    if (g_vadSilenceBlock) {
                        g_vadSilenceBlock();
                    }
                    break;
                default:
                    break;
            }
        });
        return YES;
    }
    return NO;
}

+ (BOOL)feedPcm:(int16_t *)pcmData numSamples:(int32_t)numSamples {
    if (!g_capture) return NO;
    return g_capture->feed_pcm(pcmData, static_cast<size_t>(numSamples)) ? YES : NO;
}

+ (BOOL)stopCapture {
    if (!g_capture) return NO;
    g_capture->stop();
    g_last_waveform = g_capture->get_waveform(60);
    delete g_capture;
    g_capture = nullptr;
    g_opusPacketBlock = nil;
    g_vadSilenceBlock = nil;
    return YES;
}

+ (NSArray<NSNumber *> *)lastWaveform {
    NSMutableArray<NSNumber *> *arr = [NSMutableArray arrayWithCapacity:g_last_waveform.size()];
    for (float v : g_last_waveform) {
        [arr addObject:@(v)];
    }
    g_last_waveform.clear();
    return arr;
}

+ (float)getAmplitude {
    if (!g_capture) return 0.0f;
    return g_capture->rms();
}

@end
