@echo off
rem TomiHunt extension installer - always installs to a FIXED path.
rem Chrome/Edge key unpacked extensions by their LOAD DIRECTORY: loading
rem from different folders creates separate instances with separate
rem storage. Installing into one fixed folder means your API key / resume
rem / settings survive every update forever.
setlocal
set TARGET=%LOCALAPPDATA%\TomiHunt\extension

echo [TomiHunt] Installing the extension to a fixed path:
echo [TomiHunt]   %TARGET%

rem Two supported layouts:
rem   1. Release zip - this .bat sits next to an "extension" folder
rem   2. Source tree - this .bat sits in scripts\, zip lives in ..\release\
if exist "%~dp0extension\manifest.json" goto copy-folder
if exist "%~dp0..\release\tomihunt-extension.zip" goto extract-zip

echo [TomiHunt] ERROR: extension files not found next to this script.
pause
exit /b 1

:extract-zip
if not exist "%TARGET%" mkdir "%TARGET%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%TARGET%' -Force | Remove-Item -Recurse -Force; Expand-Archive -LiteralPath '%~dp0..\release\tomihunt-extension.zip' -DestinationPath '%TARGET%' -Force"
if errorlevel 1 goto failed
goto choose

:copy-folder
if not exist "%TARGET%" mkdir "%TARGET%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%TARGET%' -Force | Remove-Item -Recurse -Force; Copy-Item -Path '%~dp0extension\*' -Destination '%TARGET%' -Recurse -Force"
if errorlevel 1 goto failed
goto choose

:failed
echo [TomiHunt] Installation failed. Try extracting the zip to a folder
echo [TomiHunt] you can write to, e.g. Downloads, and run it again.
pause
exit /b 1

:choose
echo.
echo [TomiHunt] Which browser do you use?
choice /C CE /M "[C] Chrome    [E] Edge"
if errorlevel 2 goto edge

:chrome
start chrome "chrome://extensions"
echo [TomiHunt] In Chrome: enable Developer mode top right, then click
echo [TomiHunt] "Load unpacked" and select:
echo [TomiHunt]   %TARGET%
goto done

:edge
start msedge "edge://extensions"
echo [TomiHunt] In Edge: enable Developer mode left sidebar, then click
echo [TomiHunt] "Load unpacked" and select:
echo [TomiHunt]   %TARGET%

:done
echo.
echo [TomiHunt] If you already loaded it from this path before, just click
echo [TomiHunt] the refresh icon on the TomiHunt card - your data is intact.
pause
endlocal
