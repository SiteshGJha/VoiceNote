package com.voicenote.nativeaudio

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.voicenote.core.VoiceNoteCoreJni
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

class VoiceNoteNativeAudioModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "VoiceNoteNativeAudio"

    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    private val isRecording = AtomicBoolean(false)
    private var currentSessionId: String? = null
    private var chunkIndex = 0
    private var sessionStartTime = 0L
    private var maxDurationMs = 300000L
    private var trailingChunkFile: File? = null
    private var trailingChunkDurationMs = 0L

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun isRollingRecordingActive(promise: Promise) {
        promise.resolve(isRecording.get())
    }

    @ReactMethod
    fun startRecording(promise: Promise) {
        startRollingRecording(Arguments.createMap(), promise)
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        if (!isRecording.get()) {
            promise.resolve(null)
            return
        }

        stopRollingRecording(object : Promise {
            override fun resolve(value: Any?) {
                val map = Arguments.createMap()
                val chunk = trailingChunkFile
                map.putString("uri", chunk?.absolutePath ?: "")
                map.putDouble("durationMs", trailingChunkDurationMs.toDouble())
                map.putDouble("byteLength", (chunk?.length() ?: 0L).toDouble())
                map.putBoolean("hasSpeech", (chunk?.length() ?: 0L) > 44)
                map.putInt("sampleRate", 16000)
                map.putInt("channels", 1)
                promise.resolve(map)
            }

            override fun reject(code: String, message: String?) {
                promise.reject(code, message)
            }

            override fun reject(code: String, throwable: Throwable?) {
                promise.reject(code, throwable)
            }

            override fun reject(code: String, message: String?, throwable: Throwable?) {
                promise.reject(code, message, throwable)
            }

            override fun reject(throwable: Throwable) {
                promise.reject(throwable)
            }

            override fun reject(throwable: Throwable, userInfo: WritableMap) {
                promise.reject(throwable, userInfo)
            }

            override fun reject(code: String, userInfo: WritableMap) {
                promise.reject(code, userInfo)
            }

            override fun reject(code: String, throwable: Throwable, userInfo: WritableMap) {
                promise.reject(code, throwable, userInfo)
            }

            override fun reject(code: String, message: String?, userInfo: WritableMap) {
                promise.reject(code, message, userInfo)
            }

            override fun reject(code: String, message: String?, throwable: Throwable?, userInfo: WritableMap) {
                promise.reject(code, message, throwable, userInfo)
            }

            override fun reject(message: String) {
                promise.reject("STOP_ERROR", message)
            }
        })
    }

    @ReactMethod
    fun cancelRecording(promise: Promise) {
        cancelRollingRecording(promise)
    }

    @ReactMethod
    fun startRollingRecording(options: ReadableMap?, promise: Promise) {
        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            promise.reject("PERMISSION_DENIED", "RECORD_AUDIO permission is required")
            return
        }

        if (isRecording.get()) {
            promise.resolve(true)
            return
        }

        maxDurationMs = if (options != null && options.hasKey("maxDurationMs")) {
            options.getDouble("maxDurationMs").toLong()
        } else {
            300000L
        }

        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val bufferSize = max(
            AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat),
            sampleRate * 2 // 1-second buffer
        )

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                promise.reject("AUDIO_RECORD_FAILED", "Failed to initialize AudioRecord")
                return
            }

            audioRecord?.startRecording()
            isRecording.set(true)
            currentSessionId = UUID.randomUUID().toString()
            chunkIndex = 0
            sessionStartTime = System.currentTimeMillis()
            trailingChunkFile = null
            trailingChunkDurationMs = 0L

            recordingThread = Thread({ captureAudioLoop(bufferSize) }, "VoiceNoteAudioRecordThread")
            recordingThread?.start()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUDIO_RECORD_ERROR", e.message, e)
        }
    }

    private fun captureAudioLoop(bufferSize: Int) {
        val sessionId = currentSessionId ?: return
        val cacheDir = reactContext.cacheDir
        val sampleRate = 16000
        val bytesPerMs = sampleRate * 2 / 1000 // 32 bytes/ms

        var activeChunkFile = File(cacheDir, "voicenote_chunk_${sessionId}_${chunkIndex}.wav")
        var rawChunkFile = File(cacheDir, "voicenote_chunk_${sessionId}_${chunkIndex}.raw")
        var rawOut = FileOutputStream(rawChunkFile)

        val buffer = ByteArray(bufferSize)
        var chunkBytesAccumulated = 0L
        var chunkStartTime = System.currentTimeMillis()

        while (isRecording.get()) {
            val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
            if (read > 0) {
                rawOut.write(buffer, 0, read)
                chunkBytesAccumulated += read

                // Compute metering RMS
                var sum = 0.0
                val shortCount = read / 2
                val byteBuffer = ByteBuffer.wrap(buffer, 0, read).order(ByteOrder.LITTLE_ENDIAN)
                var peak = 0.0
                for (i in 0 until shortCount) {
                    val sample = byteBuffer.short.toDouble() / 32768.0
                    sum += sample * sample
                    val abs = Math.abs(sample)
                    if (abs > peak) peak = abs
                }
                val rms = if (shortCount > 0) sqrt(sum / shortCount) else 0.0
                val dbfs = if (rms > 0.000001) 20.0 * log10(rms) else -96.0

                val meterMap = Arguments.createMap()
                meterMap.putDouble("amplitude", max(0.0, minOf(1.0, (dbfs + 60.0) / 60.0)))
                meterMap.putDouble("rawRms", rms)
                meterMap.putDouble("peak", peak)
                sendEvent("onAudioMetering", meterMap)

                val chunkDurationMs = chunkBytesAccumulated / bytesPerMs
                val totalSessionDurationMs = System.currentTimeMillis() - sessionStartTime

                // Check 5-minute ceiling
                if (totalSessionDurationMs >= maxDurationMs) {
                    sendEvent("onCeilingReached", Arguments.createMap())
                    break
                }

                // Check rolling chunk threshold: 20s to 25s window at silence midpoint
                val shouldSlice = (chunkDurationMs >= 20000L && dbfs < -36.0) || (chunkDurationMs >= 25000L)
                if (shouldSlice) {
                    rawOut.flush()
                    rawOut.close()

                    // Trim silence and write WAV header
                    val trimmed = VoiceNoteCoreJni.trimSilenceWav(
                        rawChunkFile.absolutePath,
                        activeChunkFile.absolutePath
                    )
                    rawChunkFile.delete()

                    if (trimmed && activeChunkFile.exists() && activeChunkFile.length() > 44) {
                        val chunkMap = Arguments.createMap()
                        chunkMap.putString("uri", activeChunkFile.absolutePath)
                        chunkMap.putDouble("durationMs", chunkDurationMs.toDouble())
                        chunkMap.putInt("index", chunkIndex)

                        val eventMap = Arguments.createMap()
                        eventMap.putString("sessionId", sessionId)
                        eventMap.putMap("chunk", chunkMap)
                        sendEvent("onChunkReady", eventMap)
                    } else {
                        activeChunkFile.delete()
                    }

                    chunkIndex++
                    chunkBytesAccumulated = 0L
                    chunkStartTime = System.currentTimeMillis()
                    activeChunkFile = File(cacheDir, "voicenote_chunk_${sessionId}_${chunkIndex}.wav")
                    rawChunkFile = File(cacheDir, "voicenote_chunk_${sessionId}_${chunkIndex}.raw")
                    rawOut = FileOutputStream(rawChunkFile)
                }
            }
        }

        try {
            rawOut.flush()
            rawOut.close()

            if (chunkBytesAccumulated > 0) {
                val trimmed = VoiceNoteCoreJni.trimSilenceWav(
                    rawChunkFile.absolutePath,
                    activeChunkFile.absolutePath
                )
                rawChunkFile.delete()

                if (trimmed && activeChunkFile.exists() && activeChunkFile.length() > 44) {
                    trailingChunkFile = activeChunkFile
                    trailingChunkDurationMs = chunkBytesAccumulated / bytesPerMs
                } else {
                    activeChunkFile.delete()
                    trailingChunkFile = null
                    trailingChunkDurationMs = 0L
                }
            } else {
                rawChunkFile.delete()
                activeChunkFile.delete()
            }
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun stopRollingRecording(promise: Promise) {
        if (!isRecording.get()) {
            val map = Arguments.createMap()
            map.putString("sessionId", currentSessionId ?: "")
            map.putDouble("totalDurationMs", 0.0)
            promise.resolve(map)
            return
        }

        isRecording.set(false)
        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
            recordingThread?.join(1000)
        } catch (_: Exception) {}

        val totalDurationMs = System.currentTimeMillis() - sessionStartTime
        val map = Arguments.createMap()
        map.putString("sessionId", currentSessionId ?: "")
        map.putDouble("totalDurationMs", totalDurationMs.toDouble())

        trailingChunkFile?.let { chunk ->
            if (chunk.exists()) {
                val trailingMap = Arguments.createMap()
                trailingMap.putString("uri", chunk.absolutePath)
                trailingMap.putDouble("durationMs", trailingChunkDurationMs.toDouble())
                trailingMap.putInt("index", chunkIndex)
                map.putMap("trailingChunk", trailingMap)
            }
        }

        promise.resolve(map)
    }

    @ReactMethod
    fun cancelRollingRecording(promise: Promise) {
        isRecording.set(false)
        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
            recordingThread?.interrupt()
        } catch (_: Exception) {}

        // Cleanup any temporary files for this session
        currentSessionId?.let { id ->
            val files = reactContext.cacheDir.listFiles { _, name ->
                name.contains(id)
            }
            files?.forEach { it.delete() }
        }
        currentSessionId = null
        trailingChunkFile = null
        promise.resolve(null)
    }

    @ReactMethod
    fun transcribeAudio(filePath: String, language: String?, modelPath: String?, promise: Promise) {
        Thread({
            try {
                val effectiveModelPath = modelPath ?: ""
                val effectiveLang = language ?: "en"
                val result = VoiceNoteCoreJni.transcribeAudio(
                    filePath,
                    effectiveLang,
                    effectiveModelPath
                )
                val map = Arguments.createMap()
                map.putString("text", result.text)
                map.putString("detectedLang", result.language)
                map.putDouble("durationMs", result.durationMs.toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                val msg = e.message ?: ""
                val errCode = when {
                    msg.contains("ASR_EMPTY_OUTPUT") -> "ASR_EMPTY_OUTPUT"
                    msg.contains("ASR_TIMEOUT") -> "ASR_TIMEOUT"
                    msg.contains("ASR_MODEL_MISSING") -> "ASR_MODEL_MISSING"
                    else -> "ASR_ERROR"
                }
                promise.reject(errCode, msg, e)
            }
        }, "VoiceNoteTranscribeThread").start()
    }

    @ReactMethod
    fun downloadFile(urlStr: String, targetPath: String, promise: Promise) {
        Thread({
            var input: InputStream? = null
            var output: FileOutputStream? = null
            var connection: HttpURLConnection? = null
            try {
                val targetFile = File(targetPath)
                targetFile.parentFile?.mkdirs()
                val tempFile = File(targetPath + ".download")

                var currentUrl = urlStr
                var redirects = 0
                val maxRedirects = 5

                while (redirects < maxRedirects) {
                    val url = URL(currentUrl)
                    connection = url.openConnection() as HttpURLConnection
                    connection.instanceFollowRedirects = true
                    connection.connectTimeout = 15000
                    connection.readTimeout = 30000
                    connection.connect()

                    val status = connection.responseCode
                    if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == 307 || status == 308) {
                        val newUrl = connection.getHeaderField("Location")
                        if (newUrl != null && newUrl.isNotEmpty()) {
                            currentUrl = newUrl
                            connection.disconnect()
                            redirects++
                            continue
                        }
                    }

                    if (status != HttpURLConnection.HTTP_OK) {
                        promise.reject("DOWNLOAD_ERROR", "Server returned HTTP $status")
                        return@Thread
                    }
                    break
                }

                if (redirects >= maxRedirects) {
                    promise.reject("DOWNLOAD_ERROR", "Too many redirects")
                    return@Thread
                }

                input = connection?.inputStream ?: throw java.io.IOException("No input stream")
                output = FileOutputStream(tempFile)

                val data = ByteArray(8192)
                var count: Int
                while (input.read(data).also { count = it } != -1) {
                    output.write(data, 0, count)
                }

                output.flush()
                output.close()
                input.close()

                if (tempFile.renameTo(targetFile)) {
                    promise.resolve(true)
                } else {
                    tempFile.copyTo(targetFile, overwrite = true)
                    tempFile.delete()
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.reject("DOWNLOAD_ERROR", e.message, e)
            } finally {
                connection?.disconnect()
                try { input?.close() } catch (_: Exception) {}
                try { output?.close() } catch (_: Exception) {}
            }
        }, "VoiceNoteDownloadThread").start()
    }

    @ReactMethod
    fun verifyFileChecksum(filePath: String, expectedSha256: String, promise: Promise) {
        try {
            val valid = VoiceNoteCoreJni.verifyFileChecksum(filePath, expectedSha256)
            promise.resolve(valid)
        } catch (e: Exception) {
            promise.reject("CHECKSUM_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun moveFile(sourcePath: String, targetPath: String, promise: Promise) {
        try {
            val src = File(sourcePath)
            val dst = File(targetPath)
            dst.parentFile?.mkdirs()
            if (src.renameTo(dst)) {
                promise.resolve(true)
            } else {
                src.copyTo(dst, overwrite = true)
                src.delete()
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("MOVE_FILE_ERROR", e.message, e)
        }
    }
}
