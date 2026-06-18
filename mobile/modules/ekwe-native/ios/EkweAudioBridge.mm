#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#include <string>

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

@end
