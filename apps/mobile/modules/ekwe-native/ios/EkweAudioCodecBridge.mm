#import "EkweAudioCodecBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweVorbisEncoder.h"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>

#include <algorithm>
#include <string>
#include <vector>

// Decodes any AVFoundation-readable file (MP3/FLAC/AAC/M4A/AMR/3GP/…), keeping
// the track's own sample rate/channels; normalisation to the 16 kHz mono
// contract is left to the shared C++ step, so this only has to do a faithful
// integer conversion. Returns NO when AVFoundation cannot read the track.
static BOOL decodeFileToPcm16(NSString *path, std::vector<int16_t> &out,
                              uint32_t *outRate, uint16_t *outChannels) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
    NSArray<AVAssetTrack *> *tracks = [asset tracksWithMediaType:AVMediaTypeAudio];
    if (tracks.count == 0) return NO;
    AVAssetTrack *track = tracks.firstObject;

    double sampleRate = 16000.0;
    UInt32 channels = 1;
    if (track.formatDescriptions.count > 0) {
        CMFormatDescriptionRef fmt =
            (__bridge CMFormatDescriptionRef)track.formatDescriptions.firstObject;
        const AudioStreamBasicDescription *asbd =
            CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
        if (asbd && asbd->mSampleRate > 0) sampleRate = asbd->mSampleRate;
        if (asbd && asbd->mChannelsPerFrame > 0) channels = asbd->mChannelsPerFrame;
    }

    NSError *error = nil;
    AVAssetReader *reader = [[AVAssetReader alloc] initWithAsset:asset error:&error];
    if (reader == nil) return NO;

    NSDictionary *settings = @{
        AVFormatIDKey: @(kAudioFormatLinearPCM),
        AVLinearPCMBitDepthKey: @16,
        AVLinearPCMIsFloatKey: @NO,
        AVLinearPCMIsBigEndianKey: @NO,
        AVLinearPCMIsNonInterleaved: @NO,
        AVSampleRateKey: @(sampleRate),
        AVNumberOfChannelsKey: @(channels),
    };
    AVAssetReaderTrackOutput *output =
        [[AVAssetReaderTrackOutput alloc] initWithTrack:track outputSettings:settings];
    output.alwaysCopiesSampleData = NO;
    if (![reader canAddOutput:output]) return NO;
    [reader addOutput:output];
    if (![reader startReading]) return NO;

    CMSampleBufferRef sample = NULL;
    while ((sample = [output copyNextSampleBuffer]) != NULL) {
        CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
        if (block != NULL) {
            size_t length = CMBlockBufferGetDataLength(block);
            size_t offset = out.size();
            out.resize(offset + length / sizeof(int16_t));
            CMBlockBufferCopyDataBytes(block, 0, length,
                                       reinterpret_cast<char *>(out.data() + offset));
        }
        CFRelease(sample);
    }

    if (out.empty()) return NO;
    if (outRate) *outRate = static_cast<uint32_t>(sampleRate);
    if (outChannels) *outChannels = static_cast<uint16_t>(channels);
    return YES;
}

// Encodes interleaved signed-16 PCM to an M4A/AAC-LC file through ExtAudioFile,
// so AVPlayer opens the playback copy natively. The PCM keeps the source's own
// rate/channels; Ogg sources arrive via the 16 kHz mono WAV bridge.
static BOOL encodePcmToM4a(const std::vector<int16_t> &pcm, uint32_t sampleRate,
                           uint16_t channels, NSString *outputPath) {
    if (pcm.empty() || sampleRate == 0 || channels == 0) return NO;

    AudioStreamBasicDescription src = {};
    src.mSampleRate = sampleRate;
    src.mFormatID = kAudioFormatLinearPCM;
    src.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
    src.mChannelsPerFrame = channels;
    src.mBitsPerChannel = 16;
    src.mBytesPerFrame = sizeof(int16_t) * channels;
    src.mFramesPerPacket = 1;
    src.mBytesPerPacket = src.mBytesPerFrame;

    AudioStreamBasicDescription dst = {};
    dst.mSampleRate = sampleRate;
    dst.mFormatID = kAudioFormatMPEG4AAC;
    dst.mChannelsPerFrame = channels;
    dst.mFramesPerPacket = 1024;
    UInt32 dstSize = sizeof(dst);
    if (AudioFormatGetProperty(kAudioFormatProperty_FormatInfo, 0, NULL, &dstSize, &dst) != noErr) {
        return NO;
    }

    ExtAudioFileRef file = NULL;
    CFURLRef url = (__bridge CFURLRef)[NSURL fileURLWithPath:outputPath];
    OSStatus status = ExtAudioFileCreateWithURL(url, kAudioFileM4AType, &dst, NULL,
                                                kAudioFileFlags_EraseFile, &file);
    if (status != noErr || file == NULL) return NO;

    status = ExtAudioFileSetProperty(file, kExtAudioFileProperty_ClientDataFormat,
                                     sizeof(src), &src);
    if (status != noErr) {
        ExtAudioFileDispose(file);
        return NO;
    }

    const size_t totalFrames = pcm.size() / channels;
    const UInt32 framesPerChunk = 4096;
    size_t frameIndex = 0;
    BOOL ok = YES;
    while (frameIndex < totalFrames) {
        UInt32 frames = static_cast<UInt32>(std::min<size_t>(framesPerChunk, totalFrames - frameIndex));
        AudioBufferList abl = {};
        abl.mNumberBuffers = 1;
        abl.mBuffers[0].mNumberChannels = channels;
        abl.mBuffers[0].mDataByteSize = static_cast<UInt32>(frames * src.mBytesPerFrame);
        abl.mBuffers[0].mData = const_cast<int16_t *>(pcm.data() + frameIndex * channels);
        if (ExtAudioFileWrite(file, frames, &abl) != noErr) {
            ok = NO;
            break;
        }
        frameIndex += frames;
    }
    ExtAudioFileDispose(file);
    return ok;
}

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

+ (NSArray *)encodePlaybackCopyWithSourcePath:(NSString *)sourcePath
                                   outputPath:(NSString *)outputPath
                                maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    ekwe::AudioContainer container = ekwe::classify_audio_container(input);

    std::vector<int16_t> pcm;
    uint32_t rate = 0;
    uint16_t channels = 0;

    if (container == ekwe::AudioContainer::kNotOgg) {
        return @[@(decodeFileToPcm16(sourcePath, pcm, &rate, &channels) &&
                   encodePcmToM4a(pcm, rate, channels, outputPath))];
    }

    // Ogg: the platform cannot read it, so bridge it to a WAV first.
    NSString *wavPath = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[NSString stringWithFormat:@"ekwe_share_playback_%llu.wav",
                                        (unsigned long long)([[NSDate date] timeIntervalSince1970] * 1000)]];
    ekwe::DecodeResult wavResult = ekwe::decode_audio_to_wav(
        input, std::string([wavPath UTF8String]), static_cast<size_t>(maxAudioBytes));
    if (!wavResult.success) return @[@(NO)];
    BOOL ok = decodeFileToPcm16(wavPath, pcm, &rate, &channels) &&
              encodePcmToM4a(pcm, rate, channels, outputPath);
    [[NSFileManager defaultManager] removeItemAtPath:wavPath error:nil];
    return @[@(ok)];
}

+ (NSArray *)encodePcmToOpus:(NSData *)pcm sampleRate:(NSInteger)sampleRate channels:(NSInteger)channels outputPath:(NSString *)outputPath {
    ekwe::DecodeResult result = ekwe::encode_pcm_to_opus(
        reinterpret_cast<const int16_t*>(pcm.bytes),
        static_cast<size_t>(pcm.length / sizeof(int16_t)),
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels),
        std::string([outputPath UTF8String]));
    return resultArray(result);
}

+ (NSArray *)encodePcmToVorbis:(NSData *)pcm sampleRate:(NSInteger)sampleRate channels:(NSInteger)channels outputPath:(NSString *)outputPath {
    ekwe::DecodeResult result = ekwe::encode_pcm_to_vorbis(
        std::string([outputPath UTF8String]),
        reinterpret_cast<const int16_t*>(pcm.bytes),
        static_cast<size_t>(pcm.length / sizeof(int16_t)),
        static_cast<uint32_t>(sampleRate),
        static_cast<uint16_t>(channels));
    return resultArray(result);
}

+ (NSInteger)probeAudioDurationMs:(NSString *)path {
    return ekwe::probe_audio_duration_ms(std::string([path UTF8String]));
}

@end
