import * as fs from 'fs';
import * as path from 'path';

describe('Standalone Packaging Infrastructure Sanity Tests', () => {
  const repoRoot = path.resolve(__dirname, '../..');

  describe('Packaging Scripts & Executable Permissions', () => {
    const requiredExecutableScripts = [
      'scripts/build-macos-dmg.sh',
      'scripts/build-android-release.sh',
      'scripts/generate-android-keystore.sh',
      'scripts/build-macos.sh',
      'scripts/build-android.sh',
      'android/gradlew',
    ];

    it.each(requiredExecutableScripts)('script %s exists and is executable', (relPath) => {
      const fullPath = path.join(repoRoot, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const stat = fs.statSync(fullPath);
      // Bitmask for executable bits (user, group, or other)
      const isExecutable = (stat.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });
  });

  describe('Package Size Ceiling Assertion (< 80 MB)', () => {
    it('scripts/build-macos-dmg.sh enforces 80 MB hard ceiling', () => {
      const scriptContent = fs.readFileSync(
        path.join(repoRoot, 'scripts/build-macos-dmg.sh'),
        'utf8'
      );
      expect(scriptContent).toContain('80');
      expect(scriptContent).toMatch(/exceeds the 80 MB ceiling/i);
    });

    it('scripts/build-android-release.sh enforces 80 MB hard ceiling', () => {
      const scriptContent = fs.readFileSync(
        path.join(repoRoot, 'scripts/build-android-release.sh'),
        'utf8'
      );
      expect(scriptContent).toContain('80');
      expect(scriptContent).toMatch(/exceeds the 80 MB ceiling/i);
    });
  });

  describe('Git Hygiene (.gitignore rules)', () => {
    it('.gitignore protects against committing package artifacts and keystores', () => {
      const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
      expect(gitignore).toContain('*.dmg');
      expect(gitignore).toContain('*.xcarchive');
      expect(gitignore).toContain('android/app/src/main/jniLibs/');
      expect(gitignore).toContain('macos/build/');
      expect(gitignore).toMatch(/keystore/i);
    });
  });

  describe('Android Gradle & Native Module Scaffolding', () => {
    const androidScaffoldingFiles = [
      'android/build.gradle',
      'android/settings.gradle',
      'android/gradle.properties',
      'android/gradle/wrapper/gradle-wrapper.properties',
      'android/app/build.gradle',
      'android/app/src/main/res/values/styles.xml',
      'android/app/src/main/res/values/colors.xml',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
      'android/app/proguard-rules.pro',
      'android/app/src/main/java/com/voicenote/MainActivity.kt',
      'android/app/src/main/java/com/voicenote/MainApplication.kt',
      'android/app/src/main/java/com/voicenote/core/VoiceNoteCoreJni.kt',
      'android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativeAudioModule.kt',
      'android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativePackage.kt',
    ];

    it.each(androidScaffoldingFiles)('file %s exists and is non-empty', (relPath) => {
      const fullPath = path.join(repoRoot, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('VoiceNoteNativeAudioModule declares the complete nativeAudio bridge contract methods', () => {
      const moduleContent = fs.readFileSync(
        path.join(
          repoRoot,
          'android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativeAudioModule.kt'
        ),
        'utf8'
      );
      expect(moduleContent).toContain('fun startRecording');
      expect(moduleContent).toContain('fun stopRecording');
      expect(moduleContent).toContain('fun startRollingRecording');
      expect(moduleContent).toContain('fun stopRollingRecording');
      expect(moduleContent).toContain('fun cancelRollingRecording');
      expect(moduleContent).toContain('fun transcribeAudio');
      expect(moduleContent).toContain('fun downloadFile');
      expect(moduleContent).toContain('fun verifyFileChecksum');
      expect(moduleContent).toContain('fun moveFile');
      expect(moduleContent).toContain('onChunkReady');
      expect(moduleContent).toContain('onAudioMetering');
      expect(moduleContent).toContain('onCeilingReached');
    });

    it('android/app/proguard-rules.pro protects JNI and native entry points', () => {
      const rules = fs.readFileSync(
        path.join(repoRoot, 'android/app/proguard-rules.pro'),
        'utf8'
      );
      expect(rules).toContain('com.voicenote.core');
      expect(rules).toContain('native <methods>');
    });

    it('android/settings.gradle uses React Native 0.76 settings plugin and avoids legacy native_modules.gradle', () => {
      const settings = fs.readFileSync(
        path.join(repoRoot, 'android/settings.gradle'),
        'utf8'
      );
      expect(settings).not.toContain('native_modules.gradle');
      expect(settings).toContain('com.facebook.react.settings');
    });

    it('VoiceNoteNativeAudioModule handles HTTP redirects and maps specific ASR error taxonomy codes', () => {
      const moduleContent = fs.readFileSync(
        path.join(
          repoRoot,
          'android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativeAudioModule.kt'
        ),
        'utf8'
      );
      expect(moduleContent).toMatch(/Location/i);
      expect(moduleContent).toContain('ASR_EMPTY_OUTPUT');
      expect(moduleContent).toContain('ASR_TIMEOUT');
      expect(moduleContent).toContain('ASR_MODEL_MISSING');
    });
  });

  describe('macOS Packaging Script Quality & Codesign Robustness', () => {
    it('scripts/build-macos-dmg.sh fails fast if dual Rust targets are missing', () => {
      const script = fs.readFileSync(
        path.join(repoRoot, 'scripts/build-macos-dmg.sh'),
        'utf8'
      );
      expect(script).toContain('rustup target add aarch64-apple-darwin x86_64-apple-darwin');
      expect(script).toMatch(/exit 1/);
    });

    it('scripts/build-macos-dmg.sh signs framework directories and verifies code signature strictly', () => {
      const script = fs.readFileSync(
        path.join(repoRoot, 'scripts/build-macos-dmg.sh'),
        'utf8'
      );
      expect(script).toContain('-type d -name "*.framework"');
      expect(script).toContain('codesign --verify');
    });
  });

  describe('Rust Android JNI Bindings', () => {
    it('rust/voicenote-core/src/android_jni.rs declares C-FFI entry points matching Kotlin with mutable JNIEnv', () => {
      const jniCode = fs.readFileSync(
        path.join(repoRoot, 'rust/voicenote-core/src/android_jni.rs'),
        'utf8'
      );
      expect(jniCode).toContain('Java_com_voicenote_core_VoiceNoteCoreJni_getCoreVersion');
      expect(jniCode).toContain('Java_com_voicenote_core_VoiceNoteCoreJni_verifyFileChecksum');
      expect(jniCode).toContain('Java_com_voicenote_core_VoiceNoteCoreJni_trimSilenceWav');
      expect(jniCode).toContain('Java_com_voicenote_core_VoiceNoteCoreJni_transcribeAudio');
      expect(jniCode).toMatch(/fn Java_com_voicenote_core_VoiceNoteCoreJni_getCoreVersion\(\s*mut env: JNIEnv/);
    });
  });

  describe('Packaging Documentation & NPM Scripts', () => {
    it('docs/PACKAGING.md exists and covers DMG and APK packaging and Gatekeeper bypass', () => {
      const doc = fs.readFileSync(path.join(repoRoot, 'docs/PACKAGING.md'), 'utf8');
      expect(doc).toContain('build:macos:dmg');
      expect(doc).toContain('build:android:release');
      expect(doc).toContain('xattr -cr');
      expect(doc).toContain('80 MB');
    });

    it('package.json includes packaging script targets and android platform CLI', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
      );
      expect(pkg.scripts['build:macos:dmg']).toBe('scripts/build-macos-dmg.sh');
      expect(pkg.scripts['build:android:release']).toBe('scripts/build-android-release.sh');
      expect(pkg.scripts['build:all']).toBeDefined();
      expect(pkg.scripts['generate:android:keystore']).toBe('scripts/generate-android-keystore.sh');
      expect(
        pkg.devDependencies['@react-native-community/cli-platform-android']
      ).toBeDefined();
    });
  });
});
