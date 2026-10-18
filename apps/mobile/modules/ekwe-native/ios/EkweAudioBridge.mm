#import "EkweAudioBridge.h"
#import "../cpp/EkweAudioDecoder.h"
#import "../cpp/EkweVorbisEncoder.h"
#import "../cpp/EkweCaptureController.h"
#include "../cpp/HybridEkweAudio.hpp"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#include <string>
#include <vector>
#include <utility>
#include <mutex>
#include <atomic>

// Decodes any AVFoundation-readable file (MP3/FLAC/AAC/M4A/AMR/3GP/WebM/…) to
// interleaved signed-16 PCM, reporting the track's own sample rate/channels.
// Resampling/downmixing to the 16 kHz mono contract is left to the shared C++
// normalise step, so this only has to produce a faithful integer conversion.
// Returns NO when AVFoundation cannot read the track, letting the caller
// surface the original decoder error instead of a misleading fallback one.
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

// Encodes interleaved signed-16 PCM to an M4A/AAC-LC file through ExtAudioFile,
// so the playback artifact is one AVPlayer and expo-audio both open natively.
// The PCM keeps the source's own rate/channels; only Ogg sources arrive here
// (via the 16 kHz mono WAV bridge), so AAC-LC supports both cases.
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

static NSDictionary *resolveResultDict(const ekwe::DecodeResult &result, BOOL vorbisSuccess,
                                       NSString *playbackUri = nil) {
    NSMutableArray<NSNumber *> *waveformArray = [NSMutableArray arrayWithCapacity:result.waveform.size()];
    for (float val : result.waveform) {
        [waveformArray addObject:@(val)];
    }
    NSMutableDictionary *dict = [NSMutableDictionary dictionaryWithDictionary:@{
        @"success": @(result.success),
        @"error": [NSString stringWithUTF8String:result.error_message.c_str()],
        @"durationMs": @(result.duration_ms),
        @"waveform": waveformArray,
        @"vorbisSuccess": @(vorbisSuccess),
    }];
    if (playbackUri != nil) {
        dict[@"playbackUri"] = playbackUri;
    }
    return dict;
}

static std::mutex g_mutex;
static std::atomic<float> g_current_rms{0.0f};
static ekwe::CaptureController* g_capture = nullptr;
static std::vector<float> g_last_waveform;

// Accessor for HybridEkweAudio — reads the platform's g_current_rms atomic
namespace ekwe {
    float get_current_rms() {
        return g_current_rms.load(std::memory_order_relaxed);
    }
}

@implementation EkweAudioBridge

+ (NSArray *)decodeToWavWithSourcePath:(NSString *)sourcePath
                            outputPath:(NSString *)outputPath
                         maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    std::string output([outputPath UTF8String]);

    ekwe::DecodeResult result = ekwe::decode_audio_to_wav(input, output, static_cast<size_t>(maxAudioBytes));
    return resultArray(result);
}

+ (NSInteger)probeAudioDurationMs:(NSString *)path {
    return ekwe::probe_audio_duration_ms(std::string([path UTF8String]));
}

+ (NSDictionary *)resolveAudio:(NSString *)sourcePath options:(NSDictionary *)options {
    NSString *opusOutputPath = options[@"opusOutputPath"];
    NSString *vorbisOutputPath = options[@"vorbisOutputPath"];
    NSString *playbackOutputPath = options[@"playbackOutputPath"];
    NSUInteger maxAudioBytes = [options[@"maxAudioBytes"] unsignedIntegerValue];

    std::string input([sourcePath UTF8String]);
    std::string opus_output([opusOutputPath UTF8String]);
    std::string vorbis_output =
        vorbisOutputPath.length ? std::string([vorbisOutputPath UTF8String]) : std::string();

    ekwe::AudioContainer container = ekwe::classify_audio_container(input);

    if (container == ekwe::AudioContainer::kNotOgg) {
        std::vector<int16_t> pcm;
        uint32_t rate = 0;
        uint16_t channels = 0;
        if (!decodeFileToPcm16(sourcePath, pcm, &rate, &channels)) {
            ekwe::DecodeResult failure;
            failure.error_message = "Unsupported audio format";
            return resolveResultDict(failure, NO);
        }
        ekwe::DualTranscodeResult dual = ekwe::encode_pcm_to_dual(
            pcm.data(), pcm.size(), rate, channels, opus_output, vorbis_output);
        // Eager M4A playback copy from the same PCM that fed the Opus encode,
        // ready before preview and without a WAV round-trip.
        NSString *playbackUri = nil;
        if (playbackOutputPath.length && dual.opus.success &&
            encodePcmToM4a(pcm, rate, channels, playbackOutputPath)) {
            playbackUri = playbackOutputPath;
        }
        return resolveResultDict(dual.opus, dual.vorbis.success, playbackUri);
    }

    std::vector<int16_t> pcm;
    uint32_t pcm_rate = 0;
    uint16_t pcm_channels = 1;
    ekwe::DecodeResult result = ekwe::resolve_ogg_to_artifacts(
        input, opus_output, vorbis_output, std::string(), static_cast<size_t>(maxAudioBytes),
        &pcm, &pcm_rate, &pcm_channels);

    BOOL vorbisSuccess = NO;
    if (result.success && !vorbis_output.empty()) {
        vorbisSuccess = [[NSFileManager defaultManager] fileExistsAtPath:vorbisOutputPath];
    }
    // Eager M4A playback copy from the same decode's PCM, no WAV intermediary.
    NSString *playbackUri = nil;
    if (result.success && playbackOutputPath.length && !pcm.empty() &&
        encodePcmToM4a(pcm, pcm_rate, pcm_channels, playbackOutputPath)) {
        playbackUri = playbackOutputPath;
    }
    return resolveResultDict(result, vorbisSuccess, playbackUri);
}

+ (BOOL)createPlaybackCopyWithSourcePath:(NSString *)sourcePath
                              outputPath:(NSString *)outputPath
                           maxAudioBytes:(NSUInteger)maxAudioBytes {
    std::string input([sourcePath UTF8String]);
    ekwe::AudioContainer container = ekwe::classify_audio_container(input);

    std::vector<int16_t> pcm;
    uint32_t rate = 0;
    uint16_t channels = 0;

    if (container == ekwe::AudioContainer::kNotOgg) {
        if (!decodeFileToPcm16(sourcePath, pcm, &rate, &channels)) return NO;
        return encodePcmToM4a(pcm, rate, channels, outputPath);
    }

    NSString *wavPath = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[NSString stringWithFormat:@"ekwe_playback_%llu.wav",
                                        (unsigned long long)([[NSDate date] timeIntervalSince1970] * 1000)]];
    ekwe::DecodeResult wavResult = ekwe::decode_audio_to_wav(
        input, std::string([wavPath UTF8String]), static_cast<size_t>(maxAudioBytes));
    if (!wavResult.success) return NO;
    BOOL ok = decodeFileToPcm16(wavPath, pcm, &rate, &channels) &&
              encodePcmToM4a(pcm, rate, channels, outputPath);
    [[NSFileManager defaultManager] removeItemAtPath:wavPath error:nil];
    return ok;
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

    // One recorded artifact: the Ogg Opus file. The M4A/AAC copy that iOS
    // needs for native playback is derived on demand at play time and cached
    // alongside it, so capture does not pay to write every packet twice and no
    // sibling file is orphaned on crash.
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
                    // Nitro path — zero-copy ArrayBuffer dispatch
                    if (event.data.size > 0) {
                        margelo::nitro::ekwe::HybridEkweAudio::dispatchOpusPacket(
                            event.data.data, event.data.size, event.rms);
                    }
                    // Legacy Expo event path (backward compat)
                    if (packetBlock && event.data.size > 0) {
                        NSData *packet = [NSData dataWithBytes:event.data.data
                                                        length:event.data.size];
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
    }

    // Deliberately outside g_mutex: stop() now re-decodes the finished Ogg to
    // derive the waveform, which is disk I/O plus a full decode. Holding the
    // global lock across that would stall amplitude polling and every other
    // bridge call for the duration. This is safe because g_capture was already
    // nulled above, so no other thread can reach the controller — the object is
    // exclusively owned from here until the delete.
    capture->stop();
    std::vector<float> waveform = capture->waveform();
    delete capture;

    {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_last_waveform = std::move(waveform);
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
