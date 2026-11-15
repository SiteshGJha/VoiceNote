# VoiceNote ProGuard Rules

-keep class com.voicenote.core.** { *; }
-keepclassmembers class * {
    native <methods>;
}
-keep class com.margelo.nitro.** { *; }
-keep class com.tencent.mmkv.** { *; }

-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
