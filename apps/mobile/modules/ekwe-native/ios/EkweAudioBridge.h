#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^OpusPacketCallback)(NSData *packet, float rms);
typedef void (^VadSilenceCallback)(void);

@interface EkweAudioBridge : NSObject

// Returns an array containing:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber NSInteger)
// 3: waveform (NSArray<NSNumber *>)
+ (NSArray *)transcodeToOpusWithWaveform:(NSString *)sourcePath outputPath:(NSString *)outputPath;

// Returns an array containing:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber NSInteger)
// 3: waveform (NSArray<NSNumber *>)
// Decodes to the mono/16 kHz contract and re-encodes as Vorbis-in-Ogg, the
// format Wit.ai parses (see apps/worker/src/providers/witai.ts).
// `maxAudioBytes` caps the source file size.
+ (NSArray *)transcodeToVorbisWithWaveform:(NSString *)sourcePath
                                outputPath:(NSString *)outputPath
                             maxAudioBytes:(NSUInteger)maxAudioBytes;

// Decodes once and writes both Ogg Opus and Ogg Vorbis.
// Returns @[opusArray, vorbisArray], each shaped as above.
+ (NSArray *)transcodeToDualWithWaveform:(NSString *)sourcePath
                             opusOutputPath:(NSString *)opusOutputPath
                          vorbisOutputPath:(NSString *)vorbisOutputPath
                             maxAudioBytes:(NSUInteger)maxAudioBytes;

// Duration in ms without a full decode, or -1 when it cannot be probed.
+ (NSInteger)probeAudioDurationMs:(NSString *)path;

// Returns an array containing:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber NSInteger)
// 3: waveform (NSArray<NSNumber *>)
// `maxAudioBytes` caps the source file size.
+ (NSArray *)decodeToWavWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes;

// Returns an array containing:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber NSInteger)
// 3: waveform (NSArray<NSNumber *>)
// Remuxes Ogg Opus into Opus-in-CAF (remux path, lossless) or re-encodes
// non-Opus sources to Opus CAF so AVPlayer/expo-audio can play them without a
// WAV round-trip. `maxAudioBytes` caps the source file size.
+ (NSArray *)remuxToCafWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes;

// Capture controller bridge with live-mode callback
+ (BOOL)initCapture:(NSString *)outputPath
         sampleRate:(int32_t)sampleRate
           channels:(int32_t)channels
             isLive:(BOOL)isLive
    opusPacketBlock:(OpusPacketCallback _Nullable)opusPacketBlock
    vadSilenceBlock:(VadSilenceCallback _Nullable)vadSilenceBlock;
+ (BOOL)feedPcm:(int16_t *)pcmData numSamples:(int32_t)numSamples;
+ (BOOL)feedPcmFloat:(float *)pcmData numSamples:(int32_t)numSamples;
+ (BOOL)stopCapture;
+ (float)getAmplitude;
+ (NSArray<NSNumber *> *)lastWaveform;

@end

NS_ASSUME_NONNULL_END
