# VoiceNote — Model Candidates & Bake-Off Results

## ASR Models (Whisper / Sherpa-ONNX)

| Model ID | Arch | Size | Quant | Min RAM | Target Languages | Recommended |
|---|---|---|---|---|---|---|
| `whisper-tiny-multilingual` | Whisper Tiny | ~75 MB | Q5_1 / int8 | 1 GB | English, Hindi | Fast fallback |
| `whisper-base-multilingual` | Whisper Base | ~145 MB | Q5_1 | 2 GB | English, Hindi, Hinglish | Yes (Default) |
| `whisper-small-multilingual` | Whisper Small | ~480 MB | Q4_K_M | 4 GB | English, Hindi | High accuracy |

## Tone Rewriting Models (SLM / GGUF)

| Model ID | Quant | Context | Size | Tok/s Target | Memory Budget | Notes |
|---|---|---|---|---|---|---|
| `qwen2.5-0.5b-instruct` | Q4_K_M | 2048 | ~350 MB | > 20 tok/s | < 450 MB | Lightweight, fast |
| `palmer-005` | Q4_K_M | 2048 | ~380 MB | > 18 tok/s | < 480 MB | Tested for tone shifts |
| `gemma-2-2b-instruct` | Q4_K_M | 2048 | ~1.4 GB | > 10 tok/s | ~1.5 GB | High RAM devices only |

## Bake-Off Records
*Run `/bake-off-slm` to generate benchmark runs and append results here.*
