
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


def translate_to_english(transcript: str) -> str:
    if not transcript or not transcript.strip():
        return ""

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
    return _google_translate_fallback(transcript)
