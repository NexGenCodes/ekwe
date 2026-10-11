#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^OpusPacketCallback)(NSData *packet, float rms);
typedef void (^VadSilenceCallback)(void);

@interface EkweAudioBridge : NSObject

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

// Decodes the source once and fans out to the Opus artifact plus an optional
// Vorbis copy when `options[@"vorbisOutputPath"]` is non-empty. Returns a
// dictionary with success/error/durationMs/waveform plus `vorbisSuccess`.
+ (NSDictionary *)resolveAudio:(NSString *)sourcePath options:(NSDictionary *)options;

// Decodes `sourcePath` and writes an M4A/AAC-LC playback copy at `outputPath`.
// Ogg sources go Ogg → WAV bridge → M4A; platform-readable sources decode
// straight to M4A. Returns YES on success.
+ (BOOL)createPlaybackCopyWithSourcePath:(NSString *)sourcePath
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
