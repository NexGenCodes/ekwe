#import "EkweAudioCodecBridge.h"
#import "../cpp/EkweAudioDecoder.h"

#include <string>
#include <vector>

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

@implementation EkweAudioCodecBridge

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

    ekwe::DecodeResult result = ekwe::transcode_audio_to_vorbis(
        input, output, static_cast<size_t>(maxAudioBytes));
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

+ (NSArray *)remuxToCafWithSourcePath:(NSString *)sourcePath
                           outputPath:(NSString *)outputPath
                        maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::remux_audio_to_caf(
        input, output, static_cast<size_t>(maxAudioBytes));

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

+ (NSArray *)encodePcmToOpus:(NSData *)pcm sampleRate:(NSInteger)sampleRate channels:(NSInteger)channels outputPath:(NSString *)outputPath {
    ekwe::DecodeResult result = ekwe::encode_pcm_to_opus(
        reinterpret_cast<const int16_t*>(pcm.bytes),
        static_cast<size_t>(pcm.length / sizeof(int16_t)),
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        std::string([outputPath UTF8String]));

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

+ (NSInteger)probeAudioDurationMs:(NSString *)path {
    return ekwe::probe_audio_duration_ms(std::string([path UTF8String]));
}

@end
