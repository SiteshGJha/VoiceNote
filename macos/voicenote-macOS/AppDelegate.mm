#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"voicenote";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super applicationDidFinishLaunching:notification];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>
#import <CommonCrypto/CommonDigest.h>
#import <dlfcn.h>
#include <vector>
#include <algorithm>
#include "voicenote_core.h"

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"

@interface VoiceNoteNativeAudio : RCTEventEmitter <RCTBridgeModule, AVAudioRecorderDelegate>
@end

@implementation VoiceNoteNativeAudio {
  AVAudioRecorder *_audioRecorder;
  NSTimer *_meteringTimer;
  NSString *_currentAudioPath;
  NSDate *_recordStartTime;
  float _maxLinearAmplitude;
  BOOL _hasListeners;
  
  // Rolling live capture
  NSString *_rollingSessionId;
  int _rollingChunkIndex;
  NSTimeInterval _rollingSessionStartTime;
  NSTimeInterval _currentChunkStartTime;
  NSTimer *_rollingMonitorTimer;
  NSTimer *_ceilingTimer;
  BOOL _isRollingRecording;
  float _currentSilenceDuration;
  NSDictionary *_lastRollingResult;
}

RCT_EXPORT_MODULE(VoiceNoteNativeAudio);

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onAudioMetering", @"onChunkReady", @"onCeilingReached"];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

RCT_EXPORT_METHOD(startRecording:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [self startRollingRecording:@{} resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_isRollingRecording) {
      [self->_ceilingTimer invalidate];
      self->_ceilingTimer = nil;
      [self->_rollingMonitorTimer invalidate];
      self->_rollingMonitorTimer = nil;
      [self->_meteringTimer invalidate];
      self->_meteringTimer = nil;

      self->_isRollingRecording = NO;
      if (self->_audioRecorder) {
        [self->_audioRecorder stop];
        self->_audioRecorder = nil;
      }

      NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
      NSTimeInterval totalDuration = now - self->_rollingSessionStartTime;
      NSTimeInterval trailingDuration = now - self->_currentChunkStartTime;

      unsigned long long trailingSize = 0;
      if (self->_currentAudioPath && [[NSFileManager defaultManager] fileExistsAtPath:self->_currentAudioPath]) {
        NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:self->_currentAudioPath error:nil];
        trailingSize = [attrs fileSize];
      }

      NSDictionary *trailingChunk = nil;
      if (trailingSize > 44 && trailingDuration > 0.05) {
        trailingChunk = @{
          @"uri": self->_currentAudioPath ?: @"",
          @"durationMs": @((int)(trailingDuration * 1000)),
          @"index": @(self->_rollingChunkIndex)
        };
      }

      BOOL hasSpeech = (self->_maxLinearAmplitude >= 0.025f) || (self->_rollingChunkIndex > 0);

      NSDictionary *rollingResult = @{
        @"sessionId": self->_rollingSessionId ?: @"",
        @"totalDurationMs": @((int)(totalDuration * 1000)),
        @"trailingChunk": trailingChunk ?: [NSNull null]
      };
      self->_lastRollingResult = rollingResult;

      resolve(@{
        @"uri": self->_currentAudioPath ?: @"",
        @"durationMs": @((int)(totalDuration * 1000)),
        @"byteLength": @(trailingSize),
        @"hasSpeech": @(hasSpeech),
        @"sampleRate": @(16000),
        @"channels": @(1),
        @"sessionId": self->_rollingSessionId ?: @"",
        @"trailingChunk": trailingChunk ?: [NSNull null]
      });
      return;
    }

    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;
    
    if (!self->_audioRecorder) {
      if (self->_lastRollingResult != nil) {
        NSDictionary *trailingChunk = self->_lastRollingResult[@"trailingChunk"];
        NSString *uri = (trailingChunk && ![trailingChunk isKindOfClass:[NSNull class]]) ? trailingChunk[@"uri"] : @"";
        resolve(@{
          @"uri": uri ?: @"",
          @"durationMs": self->_lastRollingResult[@"totalDurationMs"] ?: @(0),
          @"byteLength": @(0),
          @"hasSpeech": @(YES),
          @"sampleRate": @(16000),
          @"channels": @(1),
          @"sessionId": self->_lastRollingResult[@"sessionId"] ?: @"",
          @"trailingChunk": trailingChunk ?: [NSNull null]
        });
        return;
      }
      reject(@"AUDIO_NOT_RECORDING", @"No active recording found.", nil);
      return;
    }
    
    [self->_audioRecorder stop];
    self->_audioRecorder = nil;
    
    NSTimeInterval duration = 0;
    if (self->_recordStartTime) {
      duration = [[NSDate date] timeIntervalSinceDate:self->_recordStartTime];
    }
    
    NSString *filePath = self->_currentAudioPath;
    unsigned long long fileSize = 0;
    if (filePath && [[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
      NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:filePath error:nil];
      fileSize = [attrs fileSize];
    }
    
    BOOL hasSpeech = (self->_maxLinearAmplitude >= 0.025f) && (fileSize > 4096);
    NSLog(@"[VoiceNoteNativeAudio] Stop recording. Duration: %.2fs, FileSize: %llu bytes, MaxAmp: %.4f, hasSpeech: %d", duration, fileSize, self->_maxLinearAmplitude, hasSpeech);
    
    resolve(@{
      @"uri": filePath ?: @"",
      @"durationMs": @((int)(duration * 1000)),
      @"byteLength": @(fileSize),
      @"hasSpeech": @(hasSpeech),
      @"sampleRate": @(16000),
      @"channels": @(1)
    });
  });
}

RCT_EXPORT_METHOD(cancelRecording:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [self cancelRollingRecording:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(startRollingRecording:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    AVAuthorizationStatus micStatus = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (micStatus == AVAuthorizationStatusDenied || micStatus == AVAuthorizationStatusRestricted) {
      NSLog(@"[VoiceNoteNativeAudio] Microphone permission is denied or restricted.");
      reject(@"AUDIO_PERMISSION_DENIED", @"Microphone access denied in macOS System Settings.", nil);
      return;
    }

    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;
    [self->_rollingMonitorTimer invalidate];
    self->_rollingMonitorTimer = nil;
    [self->_ceilingTimer invalidate];
    self->_ceilingTimer = nil;

    if (self->_audioRecorder && self->_audioRecorder.isRecording) {
      [self->_audioRecorder stop];
      self->_audioRecorder = nil;
    }

    self->_isRollingRecording = YES;
    self->_rollingSessionId = [NSString stringWithFormat:@"session_%lld", (long long)([[NSDate date] timeIntervalSince1970] * 1000)];
    self->_rollingChunkIndex = 0;
    self->_rollingSessionStartTime = [[NSDate date] timeIntervalSince1970];
    self->_currentChunkStartTime = self->_rollingSessionStartTime;
    self->_currentSilenceDuration = 0.0f;
    self->_maxLinearAmplitude = 0.0f;

    NSString *tempDir = NSTemporaryDirectory();
    NSString *fileName = [NSString stringWithFormat:@"voicenote_chunk_%@_%d.wav", self->_rollingSessionId, self->_rollingChunkIndex];
    self->_currentAudioPath = [tempDir stringByAppendingPathComponent:fileName];
    NSURL *fileURL = [NSURL fileURLWithPath:self->_currentAudioPath];

    NSDictionary *settings = @{
      AVFormatIDKey: @(kAudioFormatLinearPCM),
      AVSampleRateKey: @(16000.0),
      AVNumberOfChannelsKey: @(1),
      AVLinearPCMBitDepthKey: @(16),
      AVLinearPCMIsBigEndianKey: @(NO),
      AVLinearPCMIsFloatKey: @(NO)
    };

    NSError *error = nil;
    self->_audioRecorder = [[AVAudioRecorder alloc] initWithURL:fileURL settings:settings error:&error];
    if (error || !self->_audioRecorder) {
      NSLog(@"[VoiceNoteNativeAudio] Failed to initialize rolling audio recorder: %@", error);
      reject(@"AUDIO_INIT_FAILED", [NSString stringWithFormat:@"Failed to create rolling audio recorder: %@", error.localizedDescription], error);
      return;
    }

    self->_audioRecorder.meteringEnabled = YES;
    if (![self->_audioRecorder record]) {
      NSLog(@"[VoiceNoteNativeAudio] Failed to start rolling recording.");
      reject(@"AUDIO_RECORD_FAILED", @"Failed to start rolling audio recording.", nil);
      return;
    }

    NSLog(@"[VoiceNoteNativeAudio] Rolling recording started. Session=%@, Chunk 0=%@", self->_rollingSessionId, self->_currentAudioPath);

    // Safety ceiling timer: default 300.0s (5 minutes)
    double maxDurationSec = 300.0;
    if (options && options[@"maxDurationMs"] && [options[@"maxDurationMs"] doubleValue] > 0) {
      maxDurationSec = [options[@"maxDurationMs"] doubleValue] / 1000.0;
    }
    self->_ceilingTimer = [NSTimer scheduledTimerWithTimeInterval:maxDurationSec repeats:NO block:^(NSTimer * _Nonnull timer) {
      NSLog(@"[VoiceNoteNativeAudio] Rolling recording hit safety ceiling (%.1fs). Dispatching onCeilingReached.", maxDurationSec);
      if (self->_hasListeners) {
        [self sendEventWithName:@"onCeilingReached" body:@{}];
      }
    }];

    // Rolling monitor and metering timer (50ms)
    self->_rollingMonitorTimer = [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer * _Nonnull timer) {
      if (!self->_audioRecorder || !self->_audioRecorder.isRecording) {
        return;
      }
      [self->_audioRecorder updateMeters];
      float avgDb = [self->_audioRecorder averagePowerForChannel:0];
      float linear = 0.0f;
      if (avgDb > -60.0f) {
        linear = powf(10.0f, avgDb / 20.0f);
      }
      if (linear > self->_maxLinearAmplitude) {
        self->_maxLinearAmplitude = linear;
      }
      if (self->_hasListeners) {
        [self sendEventWithName:@"onAudioMetering" body:@{
          @"amplitude": @(linear),
          @"rawRms": @(linear),
          @"peak": @(linear * 1.414f)
        }];
      }

      // Silence boundary evaluation: RMS < -36 dBFS (~0.0158 linear)
      if (linear < 0.0158f) {
        self->_currentSilenceDuration += 0.05f;
      } else {
        self->_currentSilenceDuration = 0.0f;
      }

      NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
      NSTimeInterval chunkElapsed = now - self->_currentChunkStartTime;

      // Slice at silence midpoint (>= 20s and >= 350ms silence) or hard ceiling at 25s
      if ((chunkElapsed >= 20.0 && self->_currentSilenceDuration >= 0.35f) || (chunkElapsed >= 25.0)) {
        NSLog(@"[VoiceNoteNativeAudio] Slicing chunk %d at %.2fs (silence=%.2fs)", self->_rollingChunkIndex, chunkElapsed, self->_currentSilenceDuration);
        
        [self->_audioRecorder stop];
        NSString *completedChunkPath = self->_currentAudioPath;
        int completedIndex = self->_rollingChunkIndex;

        if (self->_hasListeners) {
          [self sendEventWithName:@"onChunkReady" body:@{
            @"sessionId": self->_rollingSessionId ?: @"",
            @"chunk": @{
              @"uri": completedChunkPath ?: @"",
              @"durationMs": @((int)(chunkElapsed * 1000)),
              @"index": @(completedIndex)
            }
          }];
        }

        self->_rollingChunkIndex++;
        self->_currentChunkStartTime = [[NSDate date] timeIntervalSince1970];
        self->_currentSilenceDuration = 0.0f;

        NSString *nextChunkName = [NSString stringWithFormat:@"voicenote_chunk_%@_%d.wav", self->_rollingSessionId, self->_rollingChunkIndex];
        self->_currentAudioPath = [tempDir stringByAppendingPathComponent:nextChunkName];
        NSURL *nextURL = [NSURL fileURLWithPath:self->_currentAudioPath];

        NSError *nextErr = nil;
        self->_audioRecorder = [[AVAudioRecorder alloc] initWithURL:nextURL settings:settings error:&nextErr];
        if (!nextErr && self->_audioRecorder) {
          self->_audioRecorder.meteringEnabled = YES;
          [self->_audioRecorder record];
        } else {
          NSLog(@"[VoiceNoteNativeAudio] Failed to start next chunk recorder: %@", nextErr);
        }
      }
    }];

    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(stopRollingRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_ceilingTimer invalidate];
    self->_ceilingTimer = nil;
    [self->_rollingMonitorTimer invalidate];
    self->_rollingMonitorTimer = nil;
    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;

    if (!self->_isRollingRecording && !self->_audioRecorder) {
      if (self->_lastRollingResult != nil) {
        resolve(self->_lastRollingResult);
        self->_lastRollingResult = nil;
        return;
      }
      resolve(@{
        @"sessionId": self->_rollingSessionId ?: @"",
        @"totalDurationMs": @(0),
        @"trailingChunk": [NSNull null]
      });
      return;
    }

    self->_isRollingRecording = NO;
    if (self->_audioRecorder) {
      [self->_audioRecorder stop];
      self->_audioRecorder = nil;
    }

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    NSTimeInterval totalDuration = now - self->_rollingSessionStartTime;
    NSTimeInterval trailingDuration = now - self->_currentChunkStartTime;

    unsigned long long trailingSize = 0;
    if (self->_currentAudioPath && [[NSFileManager defaultManager] fileExistsAtPath:self->_currentAudioPath]) {
      NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:self->_currentAudioPath error:nil];
      trailingSize = [attrs fileSize];
    }

    NSDictionary *trailingChunk = nil;
    if (trailingSize > 44 && trailingDuration > 0.05) {
      trailingChunk = @{
        @"uri": self->_currentAudioPath ?: @"",
        @"durationMs": @((int)(trailingDuration * 1000)),
        @"index": @(self->_rollingChunkIndex)
      };
    }

    NSLog(@"[VoiceNoteNativeAudio] Stop rolling recording. Total: %.2fs, Trailing chunk: %d (%.2fs, %llu bytes)",
          totalDuration, self->_rollingChunkIndex, trailingDuration, trailingSize);

    NSDictionary *result = @{
      @"sessionId": self->_rollingSessionId ?: @"",
      @"totalDurationMs": @((int)(totalDuration * 1000)),
      @"trailingChunk": trailingChunk ?: [NSNull null]
    };
    self->_lastRollingResult = result;
    resolve(result);
  });
}

RCT_EXPORT_METHOD(cancelRollingRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_ceilingTimer invalidate];
    self->_ceilingTimer = nil;
    [self->_rollingMonitorTimer invalidate];
    self->_rollingMonitorTimer = nil;
    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;

    self->_isRollingRecording = NO;
    self->_lastRollingResult = nil;
    if (self->_audioRecorder) {
      [self->_audioRecorder stop];
      self->_audioRecorder = nil;
    }

    // Clean up all chunk files belonging to current session
    if (self->_rollingSessionId) {
      NSString *tempDir = NSTemporaryDirectory();
      NSString *prefix = [NSString stringWithFormat:@"voicenote_chunk_%@", self->_rollingSessionId];
      NSArray<NSString *> *files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:tempDir error:nil];
      for (NSString *file in files) {
        if ([file hasPrefix:prefix]) {
          NSString *filePath = [tempDir stringByAppendingPathComponent:file];
          [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
        }
      }
    }

    self->_currentAudioPath = nil;
    self->_rollingSessionId = nil;
    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(transcribeAudio:(NSString *)filePath
                 language:(NSString *)language
                 modelPath:(NSString *)modelPath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || filePath.length == 0 || ![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    reject(@"AUDIO_RECORD_FAILED", [NSString stringWithFormat:@"Audio file does not exist at URI: %@", filePath], nil);
    return;
  }

  NSString *effectiveModelPath = (modelPath && [modelPath isKindOfClass:[NSString class]] && modelPath.length > 0) ? [modelPath stringByExpandingTildeInPath] : nil;
  if (!effectiveModelPath || ![[NSFileManager defaultManager] fileExistsAtPath:effectiveModelPath]) {
    NSString *fallbackPath = [NSHomeDirectory() stringByAppendingPathComponent:@".voicenote/models/asr/whisper-base-multilingual-Q5_1.gguf"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:fallbackPath]) {
      effectiveModelPath = fallbackPath;
    }
  }

  if (!effectiveModelPath || ![[NSFileManager defaultManager] fileExistsAtPath:effectiveModelPath]) {
    NSLog(@"[VoiceNoteNativeAudio] Whisper model missing at %@", effectiveModelPath);
    reject(@"ASR_MODEL_MISSING", @"Whisper GGUF model not found on disk. Please download it first.", nil);
    return;
  }

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSData *audioData = [NSData dataWithContentsOfFile:filePath];
    if (!audioData || audioData.length == 0) {
      reject(@"ASR_EMPTY_OUTPUT", @"Cannot transcribe empty audio buffer", nil);
      return;
    }

    const uint8_t *bytes = (const uint8_t *)[audioData bytes];
    NSUInteger totalBytes = [audioData length];
    NSUInteger dataOffset = 44;
    NSUInteger pcmBytesLen = 0;

    if (totalBytes >= 12 && memcmp(bytes, "RIFF", 4) == 0 && memcmp(bytes + 8, "WAVE", 4) == 0) {
      for (NSUInteger i = 12; i + 8 <= totalBytes; ) {
        if (memcmp(bytes + i, "data", 4) == 0) {
          uint32_t chunkSize = *(const uint32_t *)(bytes + i + 4);
          dataOffset = i + 8;
          pcmBytesLen = MIN((NSUInteger)chunkSize, totalBytes - dataOffset);
          break;
        }
        uint32_t chunkSize = *(const uint32_t *)(bytes + i + 4);
        i += 8 + chunkSize;
      }
    } else {
      dataOffset = 0;
      pcmBytesLen = totalBytes;
    }

    if (dataOffset >= totalBytes || pcmBytesLen == 0) {
      reject(@"ASR_EMPTY_OUTPUT", @"Cannot transcribe empty audio buffer", nil);
      return;
    }

    NSUInteger sampleCount = pcmBytesLen / sizeof(int16_t);
    const int16_t *srcPcm = (const int16_t *)(bytes + dataOffset);

    std::vector<int16_t> paddedSamples;
    const int16_t *finalPcm = srcPcm;
    NSUInteger finalSampleCount = sampleCount;

    if (sampleCount < 16000) {
      paddedSamples.resize(16000, 0);
      std::copy(srcPcm, srcPcm + sampleCount, paddedSamples.begin());
      finalPcm = paddedSamples.data();
      finalSampleCount = 16000;
    }

    const char *cModelPath = [effectiveModelPath UTF8String];
    const char *cLanguage = (language && language.length > 0 && ![language isEqualToString:@"auto"]) ? [language UTF8String] : NULL;

    NSLog(@"[VoiceNoteNativeAudio] Calling vn_asr_transcribe with %lu samples, model: %@, lang: %@",
          (unsigned long)finalSampleCount, effectiveModelPath, language ?: @"auto");

    struct VnAsrResponse *resp = vn_asr_transcribe(
      finalPcm,
      finalSampleCount,
      cModelPath,
      cLanguage,
      NULL,
      30000
    );

    if (!resp) {
      reject(@"ASR_TIMEOUT", @"Native transcription returned null response", nil);
      return;
    }

    int32_t status = resp->status;
    NSString *transcriptText = resp->text ? [NSString stringWithUTF8String:resp->text] : @"";
    NSString *detectedLang = resp->detected_lang ? [NSString stringWithUTF8String:resp->detected_lang] : (language ?: @"en");
    uint64_t durationMs = resp->duration_ms;

    vn_asr_response_free(resp);

    if (status == 0) {
      NSLog(@"[VoiceNoteNativeAudio] ASR success in %llums (lang=%@): '%@'", durationMs, detectedLang, transcriptText);
      resolve(@{
        @"text": transcriptText ?: @"",
        @"detectedLang": detectedLang ?: @"en",
        @"durationMs": @(durationMs)
      });
    } else if (status == -101) { // AsrEmptyOutput
      NSLog(@"[VoiceNoteNativeAudio] ASR returned empty output (silence)");
      reject(@"ASR_EMPTY_OUTPUT", @"ASR returned empty transcript", nil);
    } else if (status == -102) { // AsrTimeout
      NSLog(@"[VoiceNoteNativeAudio] ASR timed out");
      reject(@"ASR_TIMEOUT", @"ASR transcription timed out", nil);
    } else if (status == -103) { // AsrModelMissing
      NSLog(@"[VoiceNoteNativeAudio] ASR model missing");
      reject(@"ASR_MODEL_MISSING", @"Whisper model missing or invalid", nil);
    } else {
      NSLog(@"[VoiceNoteNativeAudio] ASR failed with status: %d", status);
      reject(@"ASR_FAILED", [NSString stringWithFormat:@"Native ASR failed with code: %d", status], nil);
    }
  });
}


RCT_EXPORT_METHOD(downloadFile:(NSString *)urlString
                  toPath:(NSString *)targetPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!urlString || urlString.length == 0) {
    reject(@"DOWNLOAD_INVALID_URL", @"Empty URL provided", nil);
    return;
  }
  
  NSURL *url = [NSURL URLWithString:urlString];
  if (!url) {
    reject(@"DOWNLOAD_INVALID_URL", [NSString stringWithFormat:@"Invalid URL: %@", urlString], nil);
    return;
  }
  
  NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
  config.timeoutIntervalForRequest = 60.0;
  config.timeoutIntervalForResource = 900.0; // 15 mins for large ML weights
  NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
  
  NSLog(@"[VoiceNoteNativeAudio] Starting native HTTPS download from %@ to %@", urlString, targetPath);
  
  NSURLSessionDownloadTask *task = [session downloadTaskWithURL:url completionHandler:^(NSURL * _Nullable location, NSURLResponse * _Nullable response, NSError * _Nullable error) {
    if (error) {
      NSLog(@"[VoiceNoteNativeAudio] Download error: %@", error);
      reject(@"DOWNLOAD_FAILED", error.localizedDescription, error);
      return;
    }
    
    NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
    if (httpResponse.statusCode < 200 || httpResponse.statusCode >= 300) {
      NSLog(@"[VoiceNoteNativeAudio] HTTP status error: %ld", (long)httpResponse.statusCode);
      reject(@"DOWNLOAD_HTTP_ERROR", [NSString stringWithFormat:@"HTTP status %ld", (long)httpResponse.statusCode], nil);
      return;
    }
    
    if (!location) {
      reject(@"DOWNLOAD_NO_FILE", @"Temporary download file not found", nil);
      return;
    }
    
    NSString *parentDir = [targetPath stringByDeletingLastPathComponent];
    [[NSFileManager defaultManager] createDirectoryAtPath:parentDir withIntermediateDirectories:YES attributes:nil error:nil];
    
    if ([[NSFileManager defaultManager] fileExistsAtPath:targetPath]) {
      [[NSFileManager defaultManager] removeItemAtPath:targetPath error:nil];
    }
    
    NSError *moveError = nil;
    BOOL moved = [[NSFileManager defaultManager] moveItemAtURL:location toURL:[NSURL fileURLWithPath:targetPath] error:&moveError];
    if (!moved || moveError) {
      NSLog(@"[VoiceNoteNativeAudio] Failed to move downloaded file to %@: %@", targetPath, moveError);
      reject(@"DOWNLOAD_MOVE_FAILED", moveError.localizedDescription, moveError);
      return;
    }
    
    NSLog(@"[VoiceNoteNativeAudio] Download finished successfully to %@", targetPath);
    resolve(@(YES));
  }];
  
  [task resume];
}

RCT_EXPORT_METHOD(verifyFileChecksum:(NSString *)filePath
                  expectedSha256:(NSString *)expectedSha256
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || ![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    resolve(@(NO));
    return;
  }
  
  NSInputStream *inputStream = [NSInputStream inputStreamWithFileAtPath:filePath];
  if (!inputStream) {
    resolve(@(NO));
    return;
  }
  
  [inputStream open];
  CC_SHA256_CTX sha256;
  CC_SHA256_Init(&sha256);
  
  uint8_t buffer[65536];
  while ([inputStream hasBytesAvailable]) {
    NSInteger bytesRead = [inputStream read:buffer maxLength:sizeof(buffer)];
    if (bytesRead > 0) {
      CC_SHA256_Update(&sha256, buffer, (CC_LONG)bytesRead);
    } else if (bytesRead < 0) {
      [inputStream close];
      resolve(@(NO));
      return;
    }
  }
  [inputStream close];
  
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &sha256);
  
  NSMutableString *output = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
    [output appendFormat:@"%02x", digest[i]];
  }
  
  BOOL matches = [output.lowercaseString isEqualToString:expectedSha256.lowercaseString];
  NSLog(@"[VoiceNoteNativeAudio] Verified checksum for %@: actual=%@, expected=%@, match=%d", filePath, output, expectedSha256, matches);
  resolve(@(matches));
}

RCT_EXPORT_METHOD(moveFile:(NSString *)sourcePath
                  toPath:(NSString *)targetPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!sourcePath || !targetPath) {
    reject(@"FS_INVALID_PATH", @"Source or target path is missing", nil);
    return;
  }
  
  NSString *parentDir = [targetPath stringByDeletingLastPathComponent];
  [[NSFileManager defaultManager] createDirectoryAtPath:parentDir withIntermediateDirectories:YES attributes:nil error:nil];
  
  if ([[NSFileManager defaultManager] fileExistsAtPath:targetPath]) {
    [[NSFileManager defaultManager] removeItemAtPath:targetPath error:nil];
  }
  
  NSError *error = nil;
  BOOL moved = [[NSFileManager defaultManager] moveItemAtPath:sourcePath toPath:targetPath error:&error];
  if (!moved && error) {
    // If moving between volumes (e.g. /tmp to /Users/...), moveItemAtPath fails. Fall back to copy + remove
    NSError *copyError = nil;
    BOOL copied = [[NSFileManager defaultManager] copyItemAtPath:sourcePath toPath:targetPath error:&copyError];
    if (copied) {
      [[NSFileManager defaultManager] removeItemAtPath:sourcePath error:nil];
      resolve(@(YES));
      return;
    }
    NSLog(@"[VoiceNoteNativeAudio] Failed to move file from %@ to %@: %@", sourcePath, targetPath, error);
    reject(@"FS_MOVE_FAILED", error.localizedDescription, error);
    return;
  }
  
  resolve(@(YES));
}

RCT_EXPORT_METHOD(getModelsDirectory:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSString *modelsDir = [NSHomeDirectory() stringByAppendingPathComponent:@".voicenote/models"];
    [[NSFileManager defaultManager] createDirectoryAtPath:modelsDir withIntermediateDirectories:YES attributes:nil error:nil];
    resolve(modelsDir);
  });
}

RCT_EXPORT_METHOD(readTextFile:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || filePath.length == 0) {
    resolve([NSNull null]);
    return;
  }
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
      resolve([NSNull null]);
      return;
    }
    NSError *error = nil;
    NSString *content = [NSString stringWithContentsOfFile:filePath encoding:NSUTF8StringEncoding error:&error];
    if (error) {
      reject(@"FS_READ_ERROR", error.localizedDescription, error);
      return;
    }
    resolve(content ?: [NSNull null]);
  });
}

RCT_EXPORT_METHOD(writeTextFile:(NSString *)filePath
                  content:(NSString *)content
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || filePath.length == 0 || !content) {
    reject(@"FS_INVALID_PATH", @"File path or content is empty", nil);
    return;
  }
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSString *parentDir = [filePath stringByDeletingLastPathComponent];
    [[NSFileManager defaultManager] createDirectoryAtPath:parentDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSError *error = nil;
    BOOL success = [content writeToFile:filePath atomically:YES encoding:NSUTF8StringEncoding error:&error];
    if (!success || error) {
      reject(@"FS_WRITE_ERROR", error ? error.localizedDescription : @"Failed to write text file", error);
      return;
    }
    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(fileExists:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || filePath.length == 0) {
    resolve(@(NO));
    return;
  }
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    BOOL exists = [[NSFileManager defaultManager] fileExistsAtPath:filePath];
    resolve(@(exists));
  });
}

RCT_EXPORT_METHOD(getFileSize:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || filePath.length == 0) {
    resolve(@(-1));
    return;
  }
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
      resolve(@(-1));
      return;
    }
    NSError *error = nil;
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:filePath error:&error];
    if (error || !attrs) {
      resolve(@(-1));
      return;
    }
    unsigned long long size = [attrs fileSize];
    resolve(@(size));
  });
}

RCT_EXPORT_METHOD(listDirectory:(NSString *)dirPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (!dirPath || dirPath.length == 0) {
    resolve(@[]);
    return;
  }
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    if (![[NSFileManager defaultManager] fileExistsAtPath:dirPath]) {
      resolve(@[]);
      return;
    }
    NSError *error = nil;
    NSArray<NSString *> *files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dirPath error:&error];
    if (error || !files) {
      resolve(@[]);
      return;
    }
    resolve(files);
  });
}

@end

#pragma clang diagnostic pop
