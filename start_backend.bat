@echo off
REM Starts the FastAPI backend on all interfaces so the ESP32 can reach it over the LAN.
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment...
  python -m venv .venv || exit /b 1
  .venv\Scripts\python -m pip install -r requirements-dev.txt || exit /b 1
)
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
