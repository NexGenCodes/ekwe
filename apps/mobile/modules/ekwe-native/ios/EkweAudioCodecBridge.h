#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// ObjC bridge over the shared C++ encoder/decoder, compiled into the
/// EkweAudioCodec pod so the iOS share extension transcodes through the same
/// C++ pipeline as the app without linking Expo Modules Core.
@interface EkweAudioCodecBridge : NSObject

// Mirror of EkweAudioBridge's shapes:
// 0: success (NSNumber BOOL)
// 1: errorMessage (NSString)
// 2: durationMs (NSNumber Integer)
// 3: waveform (NSArray<NSNumber *>)
+ (NSArray *)transcodeToOpusWithWaveform:(NSString *)sourcePath outputPath:(NSString *)outputPath;

// Same shape as above, but writes Vorbis-in-Ogg — the only codec Wit.ai parses
// inside an Ogg container. `maxAudioBytes` caps the source file size.
+ (NSArray *)transcodeToVorbisWithWaveform:(NSString *)sourcePath
                               outputPath:(NSString *)outputPath
                            maxAudioBytes:(NSUInteger)maxAudioBytes;

// Writes an M4A/AAC-LC copy of any source into `outputPath`, for playback
// through AVPlayer (which cannot open the Ogg artifacts this bridge produces).
// Ogg sources are decoded to a 16 kHz mono WAV first; everything else goes
// through AVAssetReader. Returns @[@(success)].
+ (NSArray *)encodePlaybackCopyWithSourcePath:(NSString *)sourcePath
                                   outputPath:(NSString *)outputPath
                                maxAudioBytes:(NSUInteger)maxAudioBytes;

// Raw interleaved 16-bit PCM already decoded by the caller (AVAssetReader).
+ (NSArray *)encodePcmToOpus:(NSData *)pcm sampleRate:(NSInteger)sampleRate channels:(NSInteger)channels outputPath:(NSString *)outputPath;

// Same, encoding Vorbis-in-Ogg (the container the Wit.ai upload path needs) so
// the share extension can fall back to AVAssetReader for files the C++ core
// cannot read.
+ (NSArray *)encodePcmToVorbis:(NSData *)pcm sampleRate:(NSInteger)sampleRate channels:(NSInteger)channels outputPath:(NSString *)outputPath;

// Duration in ms, or -1 when it cannot probe.
+ (NSInteger)probeAudioDurationMs:(NSString *)path;

// Decodes once and writes both Ogg Opus and Ogg Vorbis.
// Returns @[opusArray, vorbisArray], each shaped as above.
+ (NSArray *)transcodeToDualWithWaveform:(NSString *)sourcePath
                             opusOutputPath:(NSString *)opusOutputPath
                          vorbisOutputPath:(NSString *)vorbisOutputPath
                             maxAudioBytes:(NSUInteger)maxAudioBytes;

@end

NS_ASSUME_NONNULL_END
