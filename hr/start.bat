@echo off
setlocal
title TomiHunt HR Screening
set PORT=8866

rem Prefer Python (most common on Windows), fall back to Node.
where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting TomiHunt HR screening with Python...
  start "" "http://localhost:%PORT%/index.html"
  python -m http.server %PORT% --directory "%~dp0dist"
  exit /b
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting TomiHunt HR screening with Node...
  start "" "http://localhost:%PORT%/index.html"
  node "%~dp0serve.js" %PORT%
  exit /b
)

echo.
echo Neither Python nor Node.js was found, cannot start the local server.
echo Please install one of them and re-run this file:
echo   Python:  https://www.python.org/downloads/
echo   Node.js: https://nodejs.org/
pause
