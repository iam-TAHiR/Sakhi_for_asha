"""
SAKHI 2.0 — FastAPI bridge
--------------------------
Keep this file beside backend.py.

Expected project structure:
project/
├── backend.py                 # Existing backend; do not modify
├── api_link.py                # This file
├── asha_data.db               # Existing SQLite database
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js

Run from the project directory:
    pip install fastapi uvicorn pydantic pandas
    uvicorn api_link:app --reload

The bridge imports and calls existing functions in backend.py.
It does not duplicate backend business logic or execute arbitrary
function names supplied by an HTTP client.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Optional

import backend
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sakhi.api")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="SAKHI API",
    description="FastAPI bridge between the SAKHI frontend and existing backend.py",
    version="1.0.0",
)

# Development configuration. For deployment, replace "*" with the exact
# frontend origin(s), for example ["https://your-domain.in"].
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def json_safe(value: Any) -> Any:
    """Convert backend values (including pandas/numpy values) to JSON-safe data."""
    if value is None:
        return None

    # DataFrame / Series: use pandas' JSON encoder to normalize numpy scalars,
    # timestamps and NaN values without importing pandas in this bridge.
    if hasattr(value, "to_json") and hasattr(value, "columns"):
        try:
            return json.loads(value.to_json(orient="records", date_format="iso"))
        except Exception:
            pass

    if hasattr(value, "to_dict") and not isinstance(value, dict):
        try:
            return json_safe(value.to_dict())
        except Exception:
            pass

    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]

    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value

    # Convert numpy scalar values and date/time-like objects.
    if hasattr(value, "item"):
        try:
            return json_safe(value.item())
        except Exception:
            pass

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass

    return str(value)


def response(data: Any, message: Optional[str] = None) -> dict:
    result = {"success": True, "data": json_safe(data)}
    if message:
        result["message"] = message
    return result


def require_fields(payload: dict, *fields: str) -> None:
    missing = [
        field for field in fields
        if field not in payload
        or payload[field] is None
        or (isinstance(payload[field], str) and not payload[field].strip())
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required field(s): {', '.join(missing)}",
        )


def backend_result(result: Any, success_message: str) -> dict:
    """Normalize existing backend function results without hiding failures."""
    safe = json_safe(result)

    if result is False or (
        isinstance(safe, dict)
        and safe.get("success") is False
    ) or (
        isinstance(safe, dict)
        and safe.get("res") is False
    ):
        return {
            "success": False,
            "data": safe,
            "message": (
                safe.get("message")
                or safe.get("error")
                or "The backend operation was not completed."
                if isinstance(safe, dict)
                else "The backend operation was not completed."
            ),
        }

    return response(safe, success_message)


def call_backend(function, *args, **kwargs):
    """Call a known backend function and translate unexpected errors to HTTP 500."""
    try:
        return function(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Backend function %s failed", getattr(function, "__name__", function))
        raise HTTPException(
            status_code=500,
            detail=f"Backend operation failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Health / landing
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    """Check that FastAPI and the configured SQLite database are reachable."""
    try:
        conn = backend.get_conn()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()
        return {
            "success": True,
            "api": "online",
            "database": "reachable",
            "backend_module": "backend.py",
        }
    except Exception as exc:
        logger.exception("Database health check failed")
        raise HTTPException(
            status_code=503,
            detail=f"API is running, but the database check failed: {exc}",
        ) from exc


@app.get("/api")
def api_root():
    return {
        "success": True,
        "message": "SAKHI API bridge is running.",
        "docs": "/docs",
        "health": "/api/health",
    }


# ---------------------------------------------------------------------------
# Authentication and ASHA worker profile
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    mobile: str = Field(min_length=1)
    password: str = Field(min_length=1)


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    result = call_backend(backend.login, payload.mobile.strip(), payload.password)
    safe = json_safe(result)
    if not isinstance(safe, dict) or not safe.get("success"):
        raise HTTPException(
            status_code=401,
            detail=(safe.get("message", "Login failed") if isinstance(safe, dict) else "Login failed"),
        )
    return response(safe, "Login successful")


@app.get("/api/workers")
def get_workers(worker_id: Optional[str] = Query(default=None)):
    result = call_backend(backend.get_asha_worker_profile, worker_id)
    return response(result)


@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: str):
    result = call_backend(backend.get_asha_worker_profile, worker_id)
    safe = json_safe(result)
    if not safe:
        raise HTTPException(status_code=404, detail="ASHA worker not found.")
    return response(safe)


# ---------------------------------------------------------------------------
# Dashboard / beneficiary lists / profiles / history
# --------------------------------------------------------------------------------------

@app.get("/api/dashboard")
def dashboard():
    result = call_backend(backend.get_all_records)
    return response(result)


@app.get("/api/mothers")
def mothers():
    return response(call_backend(backend.get_all_mother_list))


@app.get("/api/mothers/{beneficiary_id}")
def mother_profile(beneficiary_id: str):
    result = call_backend(backend.get_mother_profile, beneficiary_id)
    safe = json_safe(result)
    if safe is None:
        raise HTTPException(status_code=404, detail="Mother profile not found.")
    return response(safe)


@app.get("/api/children")
def children():
    return response(call_backend(backend.get_all_children_list))


@app.get("/api/children/{beneficiary_id}")
def child_profile(
    beneficiary_id: str,
    child_name: Optional[str] = Query(default=None),
):
    result = call_backend(backend.get_child_profile, beneficiary_id, child_name)
    safe = json_safe(result)
    if safe is None or safe == []:
        raise HTTPException(status_code=404, detail="Child profile not found.")
    return response(safe)


@app.get("/api/beneficiaries/history")
def beneficiary_history(
    beneficiary_id: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None, description="DD-MM-YYYY"),
    end_date: Optional[str] = Query(default=None, description="DD-MM-YYYY"),
    status: Optional[str] = Query(default=None),
):
    result = call_backend(
        backend.get_beneficiary_history_df,
        beneficiary_id,
        start_date,
        end_date,
        status,
    )
    return response(result)


# ---------------------------------------------------------------------------
# Visit operations
# ---------------------------------------------------------------------------

class AddVisitRequest(BaseModel):
    ben_id: str = Field(min_length=1)
    v_type: str = Field(min_length=1)
    due_date: str = Field(min_length=1)


@app.post("/api/visits")
def add_visit(payload: AddVisitRequest):
    result = call_backend(
        backend.add_new_visits,
        payload.ben_id,
        payload.v_type,
        payload.due_date,
    )
    return backend_result(result, "Visit created.")


class CompleteVisitRequest(BaseModel):
    visit_id: str = Field(min_length=1)
    beneficiary_id: str = Field(min_length=1)
    voice: str = Field(min_length=1)
    note: str = Field(min_length=1)
    visit_type: str = Field(min_length=1)


@app.post("/api/visits/complete")
def complete_visit(payload: CompleteVisitRequest):
    result = call_backend(
        backend.update_visit,
        payload.visit_id,
        payload.beneficiary_id,
        payload.voice,
        payload.note,
        payload.visit_type,
    )
    return backend_result(result, "Visit completion submitted.")


# ---------------------------------------------------------------------------
# Pregnancy / delivery / child registration
# ---------------------------------------------------------------------------

class AddPregnancyRequest(BaseModel):
    beneficiary_id: str = Field(min_length=1)
    week: Any
    exp_dd: str = Field(min_length=1, description="Expected delivery date in backend-supported format")
    dd: Optional[str] = None


@app.post("/api/pregnancies")
def add_pregnancy(payload: AddPregnancyRequest):
    result = call_backend(
        backend.add_new_pregnancy,
        payload.beneficiary_id,
        payload.week,
        payload.exp_dd,
        payload.dd,
    )
    return backend_result(result, "Pregnancy record submitted.")


class RegisterDeliveryRequest(BaseModel):
    beneficiary_id: str = Field(min_length=1)
    delivery_date: str = Field(min_length=1, description="DD-MM-YYYY")


@app.post("/api/deliveries")
def register_delivery(payload: RegisterDeliveryRequest):
    result = call_backend(
        backend.register_delivery,
        payload.beneficiary_id,
        payload.delivery_date,
    )
    return backend_result(result, "Delivery registration submitted.")


class AddChildRequest(BaseModel):
    beneficiary_id: str = Field(min_length=1)
    child_name: str = Field(min_length=1)
    gender: str = Field(min_length=1)
    dob: str = Field(min_length=1, description="DD-MM-YYYY")
    weight: Any
    vacs_taken: dict = Field(default_factory=dict)
    next_visit: str = Field(min_length=1)


@app.post("/api/children")
def add_child(payload: AddChildRequest):
    result = call_backend(
        backend.add_child,
        payload.beneficiary_id,
        payload.child_name,
        payload.gender,
        payload.dob,
        payload.weight,
        payload.vacs_taken,
        payload.next_visit,
    )
    return backend_result(result, "Child registration submitted.")


# ---------------------------------------------------------------------------
# Vaccination operations
# --------------------------------------------------------------------------------------

class UpdateVaccineRequest(BaseModel):
    beneficiary_id: str = Field(min_length=1)
    vaccine: str = Field(min_length=1)
    administered_date: str = Field(min_length=1, description="DD-MM-YYYY")
    mode: str = "child"
    child_name: Optional[str] = None
    pregnancy_rowid: Optional[int] = None


@app.post("/api/vaccinations")
def update_vaccine(payload: UpdateVaccineRequest):
    result = call_backend(
        backend.update_vac,
        payload.beneficiary_id,
        payload.vaccine,
        payload.administered_date,
        payload.mode,
        payload.child_name,
        payload.pregnancy_rowid,
    )
    return backend_result(result, "Vaccination update submitted.")


class CalculateVaccinesRequest(BaseModel):
    dob: str = Field(min_length=1)
    administered: dict = Field(default_factory=dict)
    mode: str = "child"
    pregnancy_week: Optional[Any] = None
    delivery_date: Optional[str] = None
    previous_td_dates: Optional[list] = None


@app.post("/api/vaccinations/calculate")
def calculate_vaccines(payload: CalculateVaccinesRequest):
    result = call_backend(
        backend.calc_vacs,
        payload.dob,
        administered=payload.administered,
        json_file="vacs.json",
        mode=payload.mode,
        pregnancy_week=payload.pregnancy_week,
        delivery_date=payload.delivery_date,
        previous_td_dates=payload.previous_td_dates,
    )
    return response(result)


# ---------------------------------------------------------------------------
# Chatbot and note-to-workflow pipeline
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    query: str = Field(min_length=1)


@app.post("/api/chat")
def chat(payload: ChatRequest):
    result = call_backend(backend.handle_asha_query, payload.query.strip())
    return response(result)


class NoteRequest(BaseModel):
    note: str = Field(min_length=1)


@app.post("/api/notes/flags")
def note_flags(payload: NoteRequest):
    return response(call_backend(backend.get_flag, payload.note))


@app.post("/api/notes/parse")
def parse_note(payload: NoteRequest):
    return response(call_backend(backend.parse_note, payload.note))


class ResolveNoteRequest(BaseModel):
    note: str = Field(min_length=1)
    parse_result: dict


@app.post("/api/notes/resolve")
def resolve_note(payload: ResolveNoteRequest):
    result = call_backend(
        backend.resolve_parameters,
        payload.note,
        payload.parse_result,
    )
    return response(result)


class ExecuteWorkflowRequest(BaseModel):
    resolved_result: dict
    confirmed: bool = False


@app.post("/api/workflows/execute")
def execute_workflow(payload: ExecuteWorkflowRequest):
    # backend.execute_workflow enforces its own readiness and confirmation checks.
    result = call_backend(
        backend.execute_workflow,
        payload.resolved_result,
        payload.confirmed,
    )
    return backend_result(result, "Workflow execution request processed.")


# ---------------------------------------------------------------------------
# Optional static frontend hosting
# ---------------------------------------------------------------------------
# Place the supplied HTML/CSS/JS files in frontend/ using these names:
# index.html, style.css, app.js. The HTML already references style.css and
# app.js with relative paths, so this preserves its existing references.
if FRONTEND_DIR.is_dir() and (FRONTEND_DIR / "index.html").is_file():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def frontend_home():
        return FileResponse(FRONTEND_DIR / "index.html")

    # The current index.html references style.css and app.js at the web root.
    @app.get("/style.css", include_in_schema=False)
    def frontend_css():
        return FileResponse(FRONTEND_DIR / "style.css")

    @app.get("/app.js", include_in_schema=False)
    def frontend_js():
        return FileResponse(FRONTEND_DIR / "app.js")
else:
    @app.get("/", include_in_schema=False)
    def frontend_not_installed():
        return {
            "message": "SAKHI API is running. Put index.html, style.css and app.js in the frontend/ folder to serve the UI.",
            "api_docs": "/docs",
            "health": "/api/health",
        }
