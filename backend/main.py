from datetime import datetime
from pathlib import Path
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import tempfile
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Depends, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv
from gnani_voice import (transcribe_audio, synthesize_speech, GnaniConfigurationError, GnaniServiceError)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
load_dotenv(BASE_DIR / ".env")
DB_PATH = BASE_DIR / "asha.db"

app = FastAPI(title="Sakhi API with Gnani Voice", version="1.2.0")

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000).hex()

def init_db():
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS visits (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            person_name TEXT NOT NULL,
            household_id TEXT NOT NULL,
            village TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            transcript TEXT DEFAULT '',
            location TEXT,
            created_at TEXT NOT NULL,
            emergency INTEGER NOT NULL DEFAULT 0,
            alerted INTEGER NOT NULL DEFAULT 0,
            audio TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_visits_user_date ON visits(user_id, created_at DESC);
        """)
        demo = conn.execute("SELECT id FROM users WHERE email=?", ("asha-demo",)).fetchone()
        if not demo:
            salt = os.urandom(16)
            conn.execute(
                """INSERT INTO users(id,name,email,password_hash,salt,created_at)
                   VALUES(?,?,?,?,?,?)""",
                (
                    "demo-asha-worker",
                    "ASHA Worker",
                    "asha-demo",
                    hash_password("Sakhi@123", salt),
                    base64.b64encode(salt).decode("ascii"),
                    datetime.utcnow().isoformat(),
                ),
            )

@app.on_event("startup")
def startup():
    init_db()

class Credentials(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)

class Visit(BaseModel):
    id: Optional[str] = None
    personName: str = Field(min_length=1, max_length=160)
    householdId: str = Field(min_length=1, max_length=100)
    village: str = ""
    phone: str = ""
    transcript: str = ""
    location: Optional[dict] = None
    createdAt: Optional[str] = None
    emergency: bool = False
    alerted: bool = False
    audio: Optional[str] = None

def issue_session(user):
    token = secrets.token_urlsafe(36)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",
            (token, user["id"], datetime.utcnow().isoformat()),
        )
    return {
        "token": token,
        "user": {"id": user["id"], "name": user["name"], "email": user["email"]},
    }

def current_user(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    token = authorization[7:]
    with get_conn() as conn:
        row = conn.execute(
            """SELECT u.id,u.name,u.email FROM sessions s
               JOIN users u ON u.id=s.user_id WHERE s.token=?""",
            (token,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    return dict(row)

@app.post("/api/auth/login")
def login(data: Credentials):
    with get_conn() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=?",
            (data.email.strip().lower(),),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="The Demo ID or password is incorrect.")
    salt = base64.b64decode(user["salt"])
    if not hmac.compare_digest(hash_password(data.password, salt), user["password_hash"]):
        raise HTTPException(status_code=401, detail="The Demo ID or password is incorrect.")
    return issue_session(user)

@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return user

@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        with get_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (authorization[7:],))
    return {"ok": True}

def visit_out(row):
    item = dict(row)
    item["personName"] = item.pop("person_name")
    item["householdId"] = item.pop("household_id")
    item["createdAt"] = item.pop("created_at")
    item["emergency"] = bool(item["emergency"])
    item["alerted"] = bool(item["alerted"])
    item["location"] = json.loads(item["location"]) if item["location"] else None
    return item

@app.get("/api/visits")
def list_visits(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM visits WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return [visit_out(row) for row in rows]

@app.post("/api/visits")
def create_visit(data: Visit, user=Depends(current_user)):
    visit_id = data.id or secrets.token_urlsafe(16)
    created = data.createdAt or datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO visits
               (id,user_id,person_name,household_id,village,phone,transcript,
                location,created_at,emergency,alerted,audio)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                visit_id, user["id"], data.personName.strip(), data.householdId.strip(),
                data.village, data.phone, data.transcript,
                json.dumps(data.location) if data.location else None,
                created, int(data.emergency), int(data.alerted), data.audio,
            ),
        )
    return {"ok": True, "id": visit_id}

@app.delete("/api/visits/{visit_id}")
def remove_visit(visit_id: str, user=Depends(current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM visits WHERE id=? AND user_id=?",
            (visit_id, user["id"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Visit record not found.")
    return {"ok": True}


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    language_code: str = Field(default="en-IN", min_length=2, max_length=12)

SUPPORTED_LANGUAGES = {
    "en-IN", "hi-IN", "kn-IN", "te-IN", "ta-IN", "mr-IN",
    "bn-IN", "gu-IN", "ml-IN", "pa-IN",
}

def validate_language(language_code: str):
    if language_code not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported language code.")

@app.post("/api/voice/transcribe")
async def voice_transcribe(
    audio_file: UploadFile = File(...),
    language_code: str = Form("en-IN"),
    user=Depends(current_user),
):
    validate_language(language_code)
    if not audio_file.content_type or not (
        audio_file.content_type.startswith("audio/")
        or audio_file.content_type == "application/octet-stream"
    ):
        raise HTTPException(status_code=415, detail="Please upload an audio recording.")
    suffix = Path(audio_file.filename or "recording.webm").suffix or ".webm"
    allowed_suffixes = {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".mp4"}
    if suffix.lower() not in allowed_suffixes:
        suffix = ".webm"
    content = await audio_file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The audio recording is empty.")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large. Keep it under 15 MB.")
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(content)
            temp_path = temp.name
        transcript_text = await run_in_threadpool(
            transcribe_audio, temp_path, language_code
        )
        return {"text": transcript_text, "language_code": language_code, "provider": "Gnani Prisma"}
    except GnaniConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GnaniServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        await audio_file.close()

@app.post("/api/voice/speak")
async def voice_speak(data: SpeechRequest, user=Depends(current_user)):
    validate_language(data.language_code)
    try:
        audio_bytes, content_type = await run_in_threadpool(
            synthesize_speech, data.text.strip(), data.language_code
        )
        return Response(
            content=audio_bytes,
            media_type=content_type,
            headers={"Cache-Control": "no-store"},
        )
    except GnaniConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GnaniServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.get("/")
def read_root():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html is missing.")
    return FileResponse(index_file)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
