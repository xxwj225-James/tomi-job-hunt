@echo off
rem TomiHunt extension installer — always extracts to a FIXED path.
rem Chrome keys unpacked extensions by their LOAD DIRECTORY: loading from
rem different folders creates separate instances with separate storage.
rem Installing into one fixed folder means your API key / resume / settings
rem survive every update forever.
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

echo [TomiHunt] Done. Opening chrome://extensions ...
start chrome "chrome://extensions"
echo.
echo [TomiHunt] In Chrome: enable Developer mode (top right),
echo [TomiHunt] then click "Load unpacked" and select:
echo [TomiHunt]   %TARGET%
echo [TomiHunt] If you already loaded it from this path before, just click
echo [TomiHunt] the refresh icon on the TomiHunt card - your data is intact.
pause
endlocal
