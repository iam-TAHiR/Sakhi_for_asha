# SAKHI — ASHA Visit & Beneficiary Support

**SAKHI** is a hackathon MVP designed to help ASHA workers prioritize household follow-ups, track beneficiary visits, monitor immunization milestones, and capture information more efficiently.

> SAKHI is a prototype decision-support and workflow tool—not a clinical diagnostic system or replacement for official guidance or professional care.

## The Problem

ASHA workers support households across maternal and child health, immunization, follow-ups, and community health activities. Managing records and deciding which households need attention can be difficult when information is scattered or follow-up tasks are easy to miss.

## Our Solution

SAKHI brings beneficiary records, visit tracking, due/overdue indicators, simple health-related alerts, and voice-enabled data capture into one workflow. It aims to support **targeted visits**, helping workers focus on households with pending needs rather than relying only on blanket visit patterns.

## MVP Features

- **Beneficiary records:** organize household and beneficiary information.
- **Visit management:** track visits and follow-up tasks through statuses such as due, follow-up, and completed.
- **Targeted follow-ups:** surface upcoming and overdue work.
- **Keyword-based flags:** identify entries containing configured warning terms for review.
- **Dashboard metrics:** summarize workload and follow-up status.
- **Immunization tracking:** compare recorded vaccination information with configured schedule data.
- **Deterministic chatbot:** provide rule-based responses to supported questions.
- **Voice workflow (integration/testing):** speech-to-text using Gnani/Vachana STT; translation of captured entries into English using Gemini; and text-to-speech using Gnani TTS. Integration is being developed and tested.
- **Mobile-friendly interface:** designed to work across desktop and phone-sized screens.

## How It Works

1. Beneficiary and visit information is entered or retrieved.
2. The application checks recorded information against configured workflow rules and schedules.
3. The dashboard presents upcoming, overdue, and completed work.
4. Flagged entries and follow-up needs are surfaced for the worker to review.
5. Voice inputs can be transcribed and translated into English to support recording.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend API | Python, FastAPI |
| Database | SQLite (MVP storage) |
| Rule logic | Python-based workflow/keyword logic |
| Speech recognition | Gnani/Vachana STT API |
| Translation | Gemini API |
| Speech synthesis | Gnani TTS API |
| Testing | Pytest |

The frontend communicates with the backend through API endpoints. SQLite is used for the prototype's local persistence. Voice services are external API integrations and require configured credentials.

## Repository Structure

The structure may evolve during development. The repository contains the frontend and backend application code and supporting schedule/configuration and test files.

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/iam-TAHiR/Sakhi_for_asha.git
cd Sakhi_for_asha
```

### 2. Create and activate a virtual environment

**Windows PowerShell:**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

Install the dependencies listed in the project's dependency file (if present). For example:

```powershell
pip install -r requirements.txt
```

### 4. Configure environment variables

Place API credentials in the appropriate backend environment file (for example, `backend/.env`, depending on the current setup). Never commit API keys.

Voice and translation features require the corresponding service credentials, including Gnani and Gemini keys, where configured.

### 5. Start the backend

Use the FastAPI application module and entry point configured in the current backend. For a FastAPI application exposed as `app`, the usual development command is:

```powershell
python -m uvicorn <module>:app --reload
```

Replace `<module>` with the actual module path for the current checkout.

### 6. Open the frontend

Run the frontend using the project's configured frontend workflow or serve its HTML files locally. If the frontend uses API calls, ensure the backend is running and the API base URL is configured correctly.

### 7. Run tests

If Pytest is configured in the checkout:

```powershell
python -m pytest
```

Tests that mock external services validate local logic without making real API requests. Live integration tests may call external APIs and consume service quota.

## Project Goals

- Make beneficiary and visit information easier to manage.
- Help surface follow-ups that may otherwise be missed.
- Support voice-based entry and language accessibility.
- Keep the workflow lightweight and usable on mobile devices.
- Provide transparent, reviewable rules rather than automated clinical decisions.

## Limitations & Safety

- SAKHI is a hackathon prototype and has not been validated for clinical use.
- Alerts and flags are only as reliable as their configured rules and the information entered.
- The prototype does not replace examination, diagnosis, clinical judgement, official reporting systems, or emergency care.
- Immunization and care schedules must be checked against current official guidance.
- Do not use real identifiable beneficiary data in demonstrations or public repositories.
- External APIs may require connectivity, credentials, and may have usage or privacy implications.

## References

Background, workflow and technical references are documented in [CITATIONS.md](CITATIONS.md) when available. The reference file is intended to explain the sources behind the prototype's design—not to certify its clinical validity.

## Hackathon

Built as a prototype for **Build Bengaluru 2.0** to explore how practical digital workflows and agentic/AI-assisted interfaces can support community health work.

---

*SAKHI — making follow-up workflows easier to track, review, and act on.*
