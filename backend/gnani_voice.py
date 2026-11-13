from __future__ import annotations
import io
import os
import threading
from pathlib import Path
from typing import Any

_stt_pipeline = None
_tts_pipeline = None
_pipeline_lock = threading.Lock()

class GnaniConfigurationError(RuntimeError):
    pass

class GnaniServiceError(RuntimeError):
    pass

def _ensure_api_key() -> str:
    key = os.getenv("GNANI_API_KEY", "").strip()
    if not key or key == "YOUR_REAL_KEY":
        raise GnaniConfigurationError(
            "Gnani is not configured. Add your GNANI_API_KEY to the backend .env file."
        )
    os.environ["GNANI_API_KEY"] = key
    return key

def _get_pipeline(task: str):
    global _stt_pipeline, _tts_pipeline
    _ensure_api_key()
    with _pipeline_lock:
        if task == "stt":
            if _stt_pipeline is None:
                try:
                    from transformers import pipeline
                    _stt_pipeline = pipeline(
                        "automatic-speech-recognition",
                        model=os.getenv("GNANI_STT_MODEL", "gnani/gnani"),
                        trust_remote_code=True,
                    )
                except Exception as exc:
                    raise GnaniServiceError(
                        f"Could not initialize Gnani Prisma STT: {exc}"
                    ) from exc
            return _stt_pipeline
        if _tts_pipeline is None:
            try:
                from transformers import pipeline
                _tts_pipeline = pipeline(
                    "text-to-speech",
                    model=os.getenv("GNANI_TTS_MODEL", "gnani/gnani"),
                    trust_remote_code=True,
                )
            except Exception as exc:
                raise GnaniServiceError(
                    f"Could not initialize Gnani Timbre TTS: {exc}"
                ) from exc
        return _tts_pipeline

def transcribe_audio(audio_path: str | Path, language_code: str) -> str:
    stt = _get_pipeline("stt")
    try:
        result = stt(str(audio_path), language_code=language_code)
        if isinstance(result, dict):
            text = result.get("text") or result.get("transcript") or ""
        else:
            text = str(result or "")
        text = str(text).strip()
        if not text:
            raise GnaniServiceError("Gnani returned an empty transcript. Please record again.")
        return text
    except GnaniServiceError:
        raise
    except Exception as exc:
        raise GnaniServiceError(f"Gnani Prisma transcription failed: {exc}") from exc

def synthesize_speech(text: str, language_code: str) -> tuple[bytes, str]:
    tts = _get_pipeline("tts")
    voice = os.getenv("GNANI_TTS_VOICE", "Nalini")
    model = os.getenv("GNANI_TTS_MODEL_VERSION", "timbre-v2.5")
    try:
        result = tts(
            text,
            voice=voice,
            model=model,
            language=language_code,
            tts_mode=os.getenv("GNANI_TTS_MODE", "realtime"),
            sample_rate=int(os.getenv("GNANI_TTS_SAMPLE_RATE", "16000")),
            container="wav",
            encoding="linear_pcm",
        )
        audio = result.get("audio") if isinstance(result, dict) else result
        if isinstance(audio, (bytes, bytearray, memoryview)):
            data = bytes(audio)
            # If the SDK returns raw PCM, wrap it as WAV.
            if data[:4] != b"RIFF":
                import wave
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(int(os.getenv("GNANI_TTS_SAMPLE_RATE", "16000")))
                    wav.writeframes(data)
                data = output.getvalue()
            return data, "audio/wav"

        try:
            import numpy as np
            import soundfile as sf
            array = np.asarray(audio)
            sample_rate = int(
                result.get("sampling_rate", int(os.getenv("GNANI_TTS_SAMPLE_RATE", "16000")))
                if isinstance(result, dict) else int(os.getenv("GNANI_TTS_SAMPLE_RATE", "16000"))
            )
            output = io.BytesIO()
            sf.write(output, array, sample_rate, format="WAV", subtype="PCM_16")
            return output.getvalue(), "audio/wav"
        except Exception as exc:
            raise GnaniServiceError(
                f"Gnani returned audio in an unsupported format: {exc}"
            ) from exc
    except GnaniServiceError:
        raise
    except Exception as exc:
        raise GnaniServiceError(f"Gnani Timbre speech generation failed: {exc}") from exc
