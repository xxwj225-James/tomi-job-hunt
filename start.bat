@echo off
rem TomiHunt Core - manual launcher (optional; the extension button does the
rem same thing after install-core.bat has been run once).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [TomiHunt] Node.js not found. Install it from https://nodejs.org
  echo [TomiHunt] Note: basic extension features (greeting/score) work
  echo [TomiHunt] without this service - just paste an API key in the
  echo [TomiHunt] extension settings page.
  pause
  exit /b 1
)

echo [TomiHunt] Starting the local Core service (127.0.0.1:3000)...
echo [TomiHunt] Keep this window open. Closing it stops the service.
echo [TomiHunt] Setup page (first run): http://127.0.0.1:3000/setup

if not exist node_modules (
  echo [TomiHunt] First run - installing dependencies, 1-2 min...
  call npm install
) else (
  if exist .git (
    echo [TomiHunt] Checking for updates...
    git pull --ff-only >nul 2>nul
    if not errorlevel 1 call npm install >nul 2>nul
  )
)

call npm start -w core
pause
