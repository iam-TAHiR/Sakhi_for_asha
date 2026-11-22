<<<<<<< HEAD

import os
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load backend/.env
load_dotenv(Path(__file__).parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in backend/.env")

# Models to try, in order
MODELS = [
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
]

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


def _call_gemini_rest(model: str, prompt: str, timeout: int = 12) -> str | None:
    """Direct REST call to Gemini — no SDK, no hidden retries."""
    url = GEMINI_API_URL.format(model=model, key=GEMINI_API_KEY)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return text.strip()
        else:
            print(f"  [{model}] HTTP {resp.status_code}: {resp.json().get('error', {}).get('message', 'unknown')}")
            return None
    except requests.exceptions.Timeout:
        print(f"  [{model}] Timed out after {timeout}s")
        return None
    except Exception as e:
        print(f"  [{model}] Error: {e}")
        return None


def _google_translate_fallback(text: str) -> str:
    """Free Google Translate API — no key needed, works for simple translation."""
    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "auto",
            "tl": "en",
            "dt": "t",
            "q": text,
        }
        resp = requests.get(url, params=params, timeout=8)
        if resp.status_code == 200:
            result = resp.json()
            translated = "".join(seg[0] for seg in result[0] if seg[0])
            return translated.strip()
    except Exception as e:
        print(f"  [Google Translate fallback] Error: {e}")
    return text  # Return original if everything fails
=======
"""Translate ASHA field-worker transcripts into English.

Gemini is tried first when GEMINI_API_KEY is configured. Google Translate's
public endpoint is used as a best-effort fallback. No API key is required at
module import time, so the FastAPI app can still start if translation is not
configured.
"""
from __future__ import annotations
import os
from pathlib import Path
import requests
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent / ".env"
if not _env_path.is_file():
    _env_path = Path(__file__).resolve().parent / "env"
load_dotenv(_env_path)
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")


def _call_gemini(prompt: str, timeout: int = 20) -> str | None:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    models_to_try = [
        os.getenv("GEMINI_MODEL", DEFAULT_MODEL),
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-latest",
        "gemini-3.8-flash",
    ]
    seen = set()
    models = [m for m in models_to_try if m and not (m in seen or seen.add(m))]
    for model in models:
        url = GEMINI_API_URL.format(model=model, key=key)
        payload = {"contents": [{"parts": [{"text": prompt}]}],
                   "generationConfig": {"temperature": 0.1}}
        try:
            resp = requests.post(url, json=payload, timeout=timeout)
            if resp.status_code == 200:
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            print(f"[translation_service] Gemini ({model}) HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as exc:
            print(f"[translation_service] Gemini ({model}) error: {exc}")
    return None


def _google_translate_fallback(text: str) -> str:
    try:
        resp = requests.get("https://translate.googleapis.com/translate_a/single",
                            params={"client": "gtx", "sl": "auto", "tl": "en", "dt": "t", "q": text}, timeout=12)
        resp.raise_for_status()
        result = resp.json()
        translated = "".join(segment[0] for segment in result[0] if segment and segment[0])
        return translated.strip() or text
    except Exception as exc:
        print(f"[translation_service] Google fallback error: {exc}")
        return text
>>>>>>> 053f8ff (Initial commit with project files)


def translate_to_english(transcript: str) -> str:
    if not transcript or not transcript.strip():
        return ""
<<<<<<< HEAD

    prompt = f"""Translate the following ASHA healthcare field-worker voice transcript into clear English.

Rules:
- Translate Kannada, Hindi and code-mixed Indian speech into English.
- Preserve names, numbers, dates and medical terms accurately.
- Do not summarize. Do not invent facts.
- If already English, clean obvious transcription errors only.
- Return only the translated text, nothing else.

Transcript:
{transcript}"""

    # Try each Gemini model via direct REST (no SDK hang)
    print("[translation_service] Translating via Gemini REST API...")
    for model in MODELS:
        result = _call_gemini_rest(model, prompt)
        if result:
            print(f"[translation_service] ✓ Success with {model}")
            return result

    # All Gemini models failed — use Google Translate as fallback
    print("[translation_service] All Gemini models busy. Using Google Translate fallback...")
=======
    prompt = f"""Translate this ASHA healthcare field-worker voice transcript into clear English.
Preserve names, beneficiary IDs, numbers, dates, measurements and medical terms exactly.
Do not summarize, omit details, or invent facts. If already English, return it with only obvious transcription cleanup.
Return only the translated text.

Transcript:
{transcript}"""
    translated = _call_gemini(prompt)
    if translated:
        return translated
>>>>>>> 053f8ff (Initial commit with project files)
    return _google_translate_fallback(transcript)
