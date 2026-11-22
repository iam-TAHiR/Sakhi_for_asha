<<<<<<< HEAD
import os
import requests
from dotenv import load_dotenv

load_dotenv()

GNANI_API_KEY = os.getenv("GNANI_API_KEY")

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"

def speech_to_text(audio_path: str, language_code: str = "indic-auto"):
    headers = {"X-API-Key-ID": GNANI_API_KEY}

    data = {
        "model": "prisma-v3.0",
        "language_code": "indic-auto",
        "language_candidates": ["en-IN", "kn-IN"],
        "format": "transcribe"
    }

    with open(audio_path, "rb") as audio:
        files = {"audio_file": (os.path.basename(audio_path), audio)}
        response = requests.post(
            STT_URL,
            headers=headers,
            files=files,
            data=data,
            timeout=60
        )

    response.raise_for_status()
    result = response.json()

    if not result.get("success"):
        raise RuntimeError(result.get("error", {}).get("message", "STT failed"))

    return {
        "text": result.get("transcript", ""),
        "language": result.get("detected_language_code"),
        "model": result.get("model"),
        "request_id": result.get("request_id")
    }

def text_to_speech(
    text: str,
    output_path: str = "sakhi_response.wav",
    language: str = "kn-IN",
    voice: str = "Lakshmi"
):
    """
    Convert text into speech using Gnani Timbre v3.0.

    Args:
        text: Response text to speak
        output_path: File where generated audio will be saved
        language: Language code, e.g. kn-IN
        voice: Timbre v3.0 voice

    Returns:
        Path to generated audio file
    """

    headers = {
        "X-API-Key-ID": GNANI_API_KEY,
        "Content-Type": "application/json"
    }

    payload = {
        "text": text,
        "voice": voice,
        "model": "timbre-v3.0",
        "language": language,
        "speed": 1.0,
        "audio_config": {
            "sample_rate": 16000,
            "num_channels": 1,
            "sample_width": 2,
            "encoding": "linear_pcm",
            "container": "wav"
        }
    }

    response = requests.post(
        TTS_URL,
        headers=headers,
        json=payload,
        timeout=60
    )

    response.raise_for_status()

    with open(output_path, "wb") as audio_file:
        audio_file.write(response.content)

    return output_path
=======
"""Gnani Vachana STT and Timbre TTS client for SAKHI."""
from __future__ import annotations
import os
from pathlib import Path
import requests
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent / ".env"
if not _env_path.is_file():
    _env_path = Path(__file__).resolve().parent / "env"
load_dotenv(_env_path)
STT_URL = os.getenv("GNANI_STT_URL", "https://api.vachana.ai/stt/v3")
TTS_URL = os.getenv("GNANI_TTS_URL", "https://api.vachana.ai/api/v1/tts/inference")


def _headers(json_body: bool = False) -> dict:
    key = os.getenv("GNANI_API_KEY")
    if not key:
        raise RuntimeError("GNANI_API_KEY is missing from the project .env file.")
    headers = {"X-API-Key-ID": key}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def speech_to_text(audio_path: str, language_code: str = "indic-auto") -> dict:
    path = Path(audio_path)
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError("Audio file does not exist or is empty.")
    data = {
        "model": os.getenv("GNANI_STT_MODEL", "prisma-v3.0"),
        "language_code": language_code or "indic-auto",
        "language_candidates": os.getenv("GNANI_LANGUAGE_CANDIDATES", "en-IN,kn-IN,hi-IN").split(","),
        "format": "transcribe",
    }
    with path.open("rb") as audio:
        files = {"audio_file": (path.name, audio)}
        resp = requests.post(STT_URL, headers=_headers(), files=files, data=data, timeout=90)
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Gnani STT HTTP {resp.status_code}: {resp.text[:800]}") from exc
    result = resp.json()
    if not result.get("success"):
        detail = result.get("error", {}).get("message", "Gnani STT failed")
        raise RuntimeError(detail)
    return {"text": result.get("transcript", ""), "language": result.get("detected_language_code"),
            "model": result.get("model"), "request_id": result.get("request_id")}


def text_to_speech(text: str, output_path: str, language: str = "en-IN", voice: str = "Lakshmi") -> str:
    if not text or not text.strip():
        raise ValueError("Text is required for speech synthesis.")
    payload = {
        "text": text.strip(), "voice": voice or "Lakshmi",
        "model": os.getenv("GNANI_TTS_MODEL", "timbre-v3.0"),
        "language": language or "en-IN", "speed": float(os.getenv("GNANI_TTS_SPEED", "1.0")),
        "audio_config": {"sample_rate": 16000, "num_channels": 1, "sample_width": 2,
                         "encoding": "linear_pcm", "container": "wav"},
    }
    resp = requests.post(TTS_URL, headers=_headers(json_body=True), json=payload, timeout=90)
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Gnani TTS HTTP {resp.status_code}: {resp.text[:800]}") from exc
    content_type = resp.headers.get("content-type", "")
    if "json" in content_type.lower():
        data = resp.json()
        raise RuntimeError(data.get("message") or data.get("error", {}).get("message") or "Gnani TTS returned JSON instead of audio.")
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(resp.content)
    return str(out)
>>>>>>> 053f8ff (Initial commit with project files)
