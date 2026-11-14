@echo off
REM Starts the React dashboard at http://localhost:5173 (proxies /api to the backend on port 8000).
cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing frontend packages...
  call npm install || exit /b 1
)
call npm run dev
