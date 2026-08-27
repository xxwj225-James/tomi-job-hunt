@echo off
rem One-time setup: registers the tomihunt:// protocol so the extension's
rem "start Core" button can launch this project. No admin rights needed
rem (writes to HKCU only). Run once after downloading the source package.
cd /d "%~dp0"

set ROOT=%~dp0..

reg add "HKCU\Software\Classes\tomihunt" /ve /t REG_SZ /d "URL:TomiHunt Core Launcher" /f >nul
reg add "HKCU\Software\Classes\tomihunt" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\tomihunt\shell\open\command" /ve /t REG_SZ /d "\"%ROOT%\scripts\launch-core.bat\" \"%%1\"" /f >nul

if errorlevel 1 (
  echo [TomiHunt] Registration failed. Run this file as the current user.
  pause
  exit /b 1
)

echo [TomiHunt] Done! The extension can now start the Core service with one click.
echo [TomiHunt] You can close this window.
pause
