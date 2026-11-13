# Sakhi — FastAPI + Gnani Prisma STT + Timbre TTS

## 1. Setup (Windows PowerShell)
```powershell
cd sakhi-gnani
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env`, then put your real Gnani API key in `.env`:

```env
GNANI_API_KEY=your_real_key
```

## 2. Start the application

```powershell
uvicorn main:app --reload
```

Open http://127.0.0.1:8000. API documentation: http://127.0.0.1:8000/docs

Demo login:
- ID: `asha-demo`
- Password: `Sakhi@123`

## 3. Backend files

- `main.py` — FastAPI app, login/session auth, visit CRUD, voice endpoints.
- `gnani_voice.py` — separate Gnani SDK adapter for Prisma STT and Timbre TTS.
- `static/index.html`, `static/styles.css`, `static/app.js` — existing UI and browser workflow.
- `asha.db` — SQLite database created automatically at first startup.

Voice endpoints (require bearer-token login):
- `POST /api/voice/transcribe` — multipart fields `audio_file`, `language_code`.
- `POST /api/voice/speak` — JSON fields `text`, `language_code`; returns WAV audio.

## 4. Gnani version / account notes

The integration follows the Python SDK / Transformers pipeline examples in the supplied `Gnani_AI_STT_TTS_Connection_Workflow_Guide.xlsx`:
- Prisma STT task: `automatic-speech-recognition`, model `gnani/gnani`.
- Timbre TTS task: `text-to-speech`, model `gnani/gnani`, Timbre version `timbre-v2.5`.
- Example language codes include `kn-IN`, `hi-IN`, and `en-IN`.

## 5. Emergency warning and flag data
The data for emergency warning and record flagging is derived from realworld scenarios and reasonable publically available data and related actions.
