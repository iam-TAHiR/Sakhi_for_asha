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