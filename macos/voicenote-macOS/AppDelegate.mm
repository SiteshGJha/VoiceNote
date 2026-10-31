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
  id _speechRecognizer;
  id _currentRecognitionTask;
}

RCT_EXPORT_MODULE(VoiceNoteNativeAudio);

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onAudioMetering"];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

RCT_EXPORT_METHOD(startRecording:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    AVAuthorizationStatus micStatus = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (micStatus == AVAuthorizationStatusDenied || micStatus == AVAuthorizationStatusRestricted) {
      NSLog(@"[VoiceNoteNativeAudio] Microphone permission is denied or restricted.");
      reject(@"AUDIO_PERMISSION_DENIED", @"Microphone access denied in macOS System Settings.", nil);
      return;
    }
    
    if (self->_audioRecorder && self->_audioRecorder.isRecording) {
      [self->_audioRecorder stop];
    }
    
    NSString *tempDir = NSTemporaryDirectory();
    long long timestamp = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    NSString *fileName = [NSString stringWithFormat:@"voicenote_rec_%lld.wav", timestamp];
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
      NSLog(@"[VoiceNoteNativeAudio] Failed to initialize audio recorder: %@", error);
      reject(@"AUDIO_INIT_FAILED", [NSString stringWithFormat:@"Failed to create audio recorder: %@", error.localizedDescription], error);
      return;
    }
    
    self->_audioRecorder.meteringEnabled = YES;
    if (![self->_audioRecorder record]) {
      NSLog(@"[VoiceNoteNativeAudio] Failed to start recording.");
      reject(@"AUDIO_RECORD_FAILED", @"Failed to start audio recording.", nil);
      return;
    }
    
    self->_recordStartTime = [NSDate date];
    self->_maxLinearAmplitude = 0.0f;
    NSLog(@"[VoiceNoteNativeAudio] Recording started to: %@", self->_currentAudioPath);
    
    [self->_meteringTimer invalidate];
    self->_meteringTimer = [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer * _Nonnull timer) {
      if (!self->_audioRecorder || !self->_audioRecorder.isRecording) {
        return;
      }
      [self->_audioRecorder updateMeters];
      float avgDb = [self->_audioRecorder averagePowerForChannel:0];
      // Convert dB (-60 to 0) to linear 0.0 to 1.0
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
    }];
    
    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;
    
    if (!self->_audioRecorder) {
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
    
    // Normal human speech into mic reaches > 0.025 linear amplitude (approx -32dB) and has non-empty payload
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
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_meteringTimer invalidate];
    self->_meteringTimer = nil;
    
    if (self->_audioRecorder) {
      [self->_audioRecorder stop];
      self->_audioRecorder = nil;
    }
    
    if (self->_currentAudioPath && [[NSFileManager defaultManager] fileExistsAtPath:self->_currentAudioPath]) {
      [[NSFileManager defaultManager] removeItemAtPath:self->_currentAudioPath error:nil];
    }
    self->_currentAudioPath = nil;
    
    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(transcribeAudio:(NSString *)filePath
                 language:(NSString *)language
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!filePath || ![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    reject(@"AUDIO_FILE_MISSING", [NSString stringWithFormat:@"Audio file does not exist at %@", filePath], nil);
    return;
  }
  
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    dlopen("/System/Library/Frameworks/Speech.framework/Speech", RTLD_LAZY);
  });
  
  Class SpeechRecognizerClass = NSClassFromString(@"SFSpeechRecognizer");
  Class SpeechURLRequestClass = NSClassFromString(@"SFSpeechURLRecognitionRequest");
  
  if (!SpeechRecognizerClass || !SpeechURLRequestClass) {
    [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
    reject(@"ASR_UNAVAILABLE", @"Speech recognition framework is not available on this macOS version.", nil);
    return;
  }
  
  typedef void (^SFAuthHandler)(NSInteger status);
  SEL reqAuthSel = NSSelectorFromString(@"requestAuthorization:");
  NSMethodSignature *sig = [SpeechRecognizerClass methodSignatureForSelector:reqAuthSel];
  if (!sig) {
    [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
    reject(@"ASR_UNAVAILABLE", @"Speech authorization selector not found.", nil);
    return;
  }
  
  void (*requestAuth)(id, SEL, SFAuthHandler) = (void (*)(id, SEL, SFAuthHandler))[SpeechRecognizerClass methodForSelector:reqAuthSel];
  
  requestAuth(SpeechRecognizerClass, reqAuthSel, ^(NSInteger status) {
    // 3 = SFSpeechRecognizerAuthorizationStatusAuthorized
    if (status != 3) {
      [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
      NSLog(@"[VoiceNoteNativeAudio] Speech authorization failed: status=%ld", (long)status);
      reject(@"ASR_PERMISSION_DENIED", @"Speech recognition permission was not granted by the user.", nil);
      return;
    }
    
    NSString *localeId = [language isEqualToString:@"hi"] ? @"hi-IN" : @"en-US";
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:localeId];
    id recognizer = [[SpeechRecognizerClass alloc] performSelector:NSSelectorFromString(@"initWithLocale:") withObject:locale];
    
    BOOL isAvailable = NO;
    if (recognizer && [recognizer respondsToSelector:NSSelectorFromString(@"isAvailable")]) {
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[recognizer methodSignatureForSelector:NSSelectorFromString(@"isAvailable")]];
      [inv setSelector:NSSelectorFromString(@"isAvailable")];
      [inv setTarget:recognizer];
      [inv invoke];
      [inv getReturnValue:&isAvailable];
    }
    
    if (!recognizer || !isAvailable) {
      recognizer = [[SpeechRecognizerClass alloc] performSelector:NSSelectorFromString(@"initWithLocale:") withObject:[NSLocale currentLocale]];
    }
    
    if (!recognizer) {
      [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
      NSLog(@"[VoiceNoteNativeAudio] Speech recognizer not available");
      reject(@"ASR_MODEL_MISSING", @"Speech recognizer is not available on this device.", nil);
      return;
    }
    
    // Retain speech recognizer instance to prevent premature deallocation during async task
    self->_speechRecognizer = recognizer;
    
    NSURL *fileURL = [NSURL fileURLWithPath:filePath];
    id request = [[SpeechURLRequestClass alloc] performSelector:NSSelectorFromString(@"initWithURL:") withObject:fileURL];
    
    // Dictation task hint (enables continuous multi-sentence dictation instead of short queries)
    if ([request respondsToSelector:NSSelectorFromString(@"setTaskHint:")]) {
      NSInteger taskHint = 1; // SFSpeechRecognitionTaskHintDictation
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[request methodSignatureForSelector:NSSelectorFromString(@"setTaskHint:")]];
      [inv setSelector:NSSelectorFromString(@"setTaskHint:")];
      [inv setTarget:request];
      [inv setArgument:&taskHint atIndex:2];
      [inv invoke];
    }
    
    // Automatic punctuation (macOS 13+)
    if ([request respondsToSelector:NSSelectorFromString(@"setAddsPunctuation:")]) {
      BOOL addsPunc = YES;
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[request methodSignatureForSelector:NSSelectorFromString(@"setAddsPunctuation:")]];
      [inv setSelector:NSSelectorFromString(@"setAddsPunctuation:")];
      [inv setTarget:request];
      [inv setArgument:&addsPunc atIndex:2];
      [inv invoke];
    }
    
    // Contextual vocabulary biasing hints
    if ([request respondsToSelector:NSSelectorFromString(@"setContextualStrings:")]) {
      NSArray *contextWords = @[
        @"DuckDB", @"Polars", @"Dask", @"DataFrame", @"Parquet", @"CSV", @"DAG",
        @"CPython", @"Python", @"RAM", @"GGUF", @"Whisper", @"VoiceNote", @"ASR", @"SLM"
      ];
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[request methodSignatureForSelector:NSSelectorFromString(@"setContextualStrings:")]];
      [inv setSelector:NSSelectorFromString(@"setContextualStrings:")];
      [inv setTarget:request];
      [inv setArgument:&contextWords atIndex:2];
      [inv invoke];
    }
    
    BOOL supportsOnDevice = NO;
    if ([recognizer respondsToSelector:NSSelectorFromString(@"supportsOnDeviceRecognition")]) {
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[recognizer methodSignatureForSelector:NSSelectorFromString(@"supportsOnDeviceRecognition")]];
      [inv setSelector:NSSelectorFromString(@"supportsOnDeviceRecognition")];
      [inv setTarget:recognizer];
      [inv invoke];
      [inv getReturnValue:&supportsOnDevice];
    }
    
    if (supportsOnDevice && [request respondsToSelector:NSSelectorFromString(@"setRequiresOnDeviceRecognition:")]) {
      BOOL reqOnDevice = YES;
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[request methodSignatureForSelector:NSSelectorFromString(@"setRequiresOnDeviceRecognition:")]];
      [inv setSelector:NSSelectorFromString(@"setRequiresOnDeviceRecognition:")];
      [inv setTarget:request];
      [inv setArgument:&reqOnDevice atIndex:2];
      [inv invoke];
    }
    
    // Enable partial results to continuously stream transcriptions across pauses
    if ([request respondsToSelector:NSSelectorFromString(@"setShouldReportPartialResults:")]) {
      BOOL partial = YES;
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[request methodSignatureForSelector:NSSelectorFromString(@"setShouldReportPartialResults:")]];
      [inv setSelector:NSSelectorFromString(@"setShouldReportPartialResults:")];
      [inv setTarget:request];
      [inv setArgument:&partial atIndex:2];
      [inv invoke];
    }
    
    NSDate *transcribeStart = [NSDate date];
    __block BOOL didRespond = NO;
    __block NSString *latestTranscription = @"";
    
    // Safety timeout (60s)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(60 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (!didRespond) {
        didRespond = YES;
        if (self->_currentRecognitionTask && [self->_currentRecognitionTask respondsToSelector:NSSelectorFromString(@"cancel")]) {
          [self->_currentRecognitionTask performSelector:NSSelectorFromString(@"cancel")];
        }
        self->_currentRecognitionTask = nil;
        self->_speechRecognizer = nil;
        [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
        
        if (latestTranscription.length > 0) {
          NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:transcribeStart];
          NSLog(@"[VoiceNoteNativeAudio] ASR timeout elapsed with partial transcript in %.2fs: \"%@\"", elapsed, latestTranscription);
          resolve(@{
            @"text": latestTranscription,
            @"detectedLang": (language ?: @"en"),
            @"durationMs": @((int)(elapsed * 1000))
          });
        } else {
          NSLog(@"[VoiceNoteNativeAudio] ASR transcription timed out after 60s");
          reject(@"ASR_TIMEOUT", @"ASR transcription timed out after 60s.", nil);
        }
      }
    });
    
    typedef void (^SFResultHandler)(id result, NSError *error);
    SFResultHandler handler = ^(id result, NSError *error) {
      if (didRespond) {
        return;
      }
      
      if (result && [result respondsToSelector:NSSelectorFromString(@"bestTranscription")]) {
        id bestTranscription = [result performSelector:NSSelectorFromString(@"bestTranscription")];
        if (bestTranscription && [bestTranscription respondsToSelector:NSSelectorFromString(@"formattedString")]) {
          NSString *str = [bestTranscription performSelector:NSSelectorFromString(@"formattedString")];
          if (str && str.length > 0) {
            latestTranscription = str;
          }
        }
      }
      
      BOOL isFinal = NO;
      if (result && [result respondsToSelector:NSSelectorFromString(@"isFinal")]) {
        NSInvocation *inv = [NSInvocation invocationWithMethodSignature:[result methodSignatureForSelector:NSSelectorFromString(@"isFinal")]];
        [inv setSelector:NSSelectorFromString(@"isFinal")];
        [inv setTarget:result];
        [inv invoke];
        [inv getReturnValue:&isFinal];
      }
      
      if (isFinal) {
        didRespond = YES;
        self->_currentRecognitionTask = nil;
        self->_speechRecognizer = nil;
        [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
        
        NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:transcribeStart];
        NSLog(@"[VoiceNoteNativeAudio] ASR completed in %.2fs: \"%@\"", elapsed, latestTranscription);
        resolve(@{
          @"text": latestTranscription ?: @"",
          @"detectedLang": (language ?: @"en"),
          @"durationMs": @((int)(elapsed * 1000))
        });
        return;
      }
      
      if (error) {
        didRespond = YES;
        self->_currentRecognitionTask = nil;
        self->_speechRecognizer = nil;
        [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
        
        if (latestTranscription.length > 0) {
          NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:transcribeStart];
          NSLog(@"[VoiceNoteNativeAudio] ASR stream closed with transcribed text in %.2fs: \"%@\"", elapsed, latestTranscription);
          resolve(@{
            @"text": latestTranscription,
            @"detectedLang": (language ?: @"en"),
            @"durationMs": @((int)(elapsed * 1000))
          });
        } else {
          NSLog(@"[VoiceNoteNativeAudio] ASR transcription failed: %@", error);
          reject(@"ASR_FAILED", [NSString stringWithFormat:@"ASR transcription failed: %@", error.localizedDescription], error);
        }
        return;
      }
    };
    
    SEL recTaskSel = NSSelectorFromString(@"recognitionTaskWithRequest:resultHandler:");
    NSMethodSignature *taskSig = [recognizer methodSignatureForSelector:recTaskSel];
    if (!taskSig) {
      self->_speechRecognizer = nil;
      [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
      reject(@"ASR_UNAVAILABLE", @"Recognition task method not found.", nil);
      return;
    }
    
    id (*startTask)(id, SEL, id, SFResultHandler) = (id (*)(id, SEL, id, SFResultHandler))[recognizer methodForSelector:recTaskSel];
    id task = startTask(recognizer, recTaskSel, request, handler);
    self->_currentRecognitionTask = task;
    NSLog(@"[VoiceNoteNativeAudio] Recognition task started: %@", task);
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

@end

#pragma clang diagnostic pop
