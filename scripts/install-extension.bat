@echo off
rem TomiHunt extension installer — always extracts to a FIXED path.
rem Chrome/Edge key unpacked extensions by their LOAD DIRECTORY: loading
rem from different folders creates separate instances with separate
rem storage. Installing into one fixed folder means your API key / resume
rem / settings survive every update forever.
setlocal
set TARGET=%LOCALAPPDATA%\TomiHunt\extension

echo [TomiHunt] Installing the extension to a fixed path:
echo [TomiHunt]   %TARGET%

if not exist "%~dp0..\release\tomihunt-extension.zip" (
  echo [TomiHunt] ERROR: release\tomihunt-extension.zip not found next to this script.
  pause
  exit /b 1
)

if not exist "%TARGET%" mkdir "%TARGET%"
rem Clear stale files, then extract the zip (PowerShell handles zip natively)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%TARGET%' -Force | Remove-Item -Recurse -Force; Expand-Archive -LiteralPath '%~dp0..\release\tomihunt-extension.zip' -DestinationPath '%TARGET%' -Force"

if errorlevel 1 (
  echo [TomiHunt] Extraction failed.
  pause
  exit /b 1
)

echo.
echo [TomiHunt] Which browser do you use?
choice /C CE /M "[C] Chrome    [E] Edge"
if errorlevel 2 goto edge

:chrome
start chrome "chrome://extensions"
echo [TomiHunt] In Chrome: enable Developer mode (top right), then click
echo [TomiHunt] "Load unpacked" and select:
echo [TomiHunt]   %TARGET%
goto done

:edge
start msedge "edge://extensions"
echo [TomiHunt] In Edge: enable Developer mode (left sidebar), then click
echo [TomiHunt] "Load unpacked" and select:
echo [TomiHunt]   %TARGET%

:done
echo.
echo [TomiHunt] If you already loaded it from this path before, just click
echo [TomiHunt] the refresh icon on the TomiHunt card - your data is intact.
pause
endlocal
