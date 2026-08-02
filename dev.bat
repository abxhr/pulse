@echo off
REM Runs backend and frontend in two windows
start "Pulse backend" cmd /k "cd backend && python -m uvicorn app.main:app --reload --port 8080"
start "Pulse frontend" cmd /k "cd frontend && npm run dev"
