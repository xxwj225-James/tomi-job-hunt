@echo off
rem TomiHunt Core launcher - triggered by the extension button via
rem tomihunt://core/start protocol (registered once by install-core.bat).
cd /d "%~dp0.."

rem Already running? Leave it alone. Must be an actual TomiHunt response
rem (curl -f fails on 404; findstr matches the JSON body) - a random other
rem app occupying the port must NOT stop the launch.
curl -sf --max-time 2 http://127.0.0.1:3000/health 2>nul | findstr /c:"ok" >nul 2>nul
if not errorlevel 1 exit /b 0

where node >nul 2>nul
if errorlevel 1 (
  echo [TomiHunt] Node.js not found. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [TomiHunt] First run - installing dependencies, 1-2 min...
  call npm install
)

rem Start hidden: no console window, no manual step for the user.
start "" wscript.exe "%~dp0launch-core-hidden.vbs" "%~dp0.."
exit /b 0
