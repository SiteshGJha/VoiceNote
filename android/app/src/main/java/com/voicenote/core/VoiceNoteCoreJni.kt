package com.voicenote.core

data class VoiceNoteAsrResult(
    val text: String,
    val language: String,
    val durationMs: Long
)

object VoiceNoteCoreJni {
    init {
        try {
            System.loadLibrary("voicenote_core")
        } catch (e: UnsatisfiedLinkError) {
            System.err.println("VoiceNoteCoreJni: libvoicenote_core not loaded ($e)")
        }
    }

    @JvmStatic external fun trimSilenceWav(inputPath: String, outputPath: String): Boolean
    @JvmStatic external fun verifyFileChecksum(filePath: String, expectedSha256: String): Boolean
    @JvmStatic external fun transcribeAudio(filePath: String, language: String, modelPath: String): VoiceNoteAsrResult
    @JvmStatic external fun getCoreVersion(): String
}
