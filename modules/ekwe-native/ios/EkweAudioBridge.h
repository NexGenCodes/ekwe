#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface EkweAudioBridge : NSObject

// Returns an array containing:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber NSInteger)
// 3: waveform (NSArray<NSNumber *> or FloatArray equivalent)
+ (NSArray *)extractWavAndWaveform:(NSString *)sourcePath outputPath:(NSString *)outputPath;

@end

NS_ASSUME_NONNULL_END
