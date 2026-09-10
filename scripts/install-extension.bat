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
if not exist "%TARGET%\manifest.json" goto failed
goto choose

:copy-folder
if not exist "%TARGET%" mkdir "%TARGET%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%TARGET%' -Force | Remove-Item -Recurse -Force; Copy-Item -Path '%~dp0extension\*' -Destination '%TARGET%' -Recurse -Force"
if errorlevel 1 goto failed
rem Verify instead of trusting the copy: a silent failure here is what makes
rem the browser show an empty/errored card later.
if not exist "%TARGET%\manifest.json" goto failed
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
rem Read the choice in the next statement: every command in between (echo, set,
rem start) overwrites errorlevel.
set BCHOICE=%errorlevel%
if "%BCHOICE%"=="2" goto edge

:chrome
set BNAME=Chrome
set PAGE=chrome://extensions
goto guide

:edge
set BNAME=Edge
set PAGE=edge://extensions

:guide
rem The folder path goes to the clipboard (it is far too long to type, and the
rem "Load unpacked" dialog takes it). Only ONE thing fits on the clipboard, so
rem the page URL stays a printed line for the user to type - it is short.
rem Set-Clipboard, not "echo %TARGET%|clip": cmd's echo puts a trailing space in
rem the clipboard (measured), and a pasted path with a stray space can be
rem rejected by the folder dialog.
powershell -NoProfile -Command "Set-Clipboard -Value '%TARGET%'"

rem Launch the browser PLAINLY - never with the page URL. Chromium silently
rem drops chrome:// given on the command line (cold or warm), so that only ever
rem produced a blank tab; the URL is left for the user to type instead.
start "" %BNAME%

echo.
echo [TomiHunt] Opened %BNAME% (start it yourself if no window appeared).
echo [TomiHunt] ------------------------------------------------------------
echo [TomiHunt] Load this folder in %BNAME%:
echo [TomiHunt]   %TARGET%
echo [TomiHunt]   (already copied to the clipboard - paste it in the dialog)
echo [TomiHunt] ------------------------------------------------------------
echo [TomiHunt] 1. In %BNAME% press Ctrl+L, type %PAGE% and hit Enter
echo [TomiHunt]    A program cannot open that page for you: Chrome/Edge DROP
echo [TomiHunt]    chrome://-style URLs handed to them on the command line, so
echo [TomiHunt]    a browser launched "onto" the page only shows a blank tab.
echo [TomiHunt] 2. Turn on "Developer mode"
echo [TomiHunt] 3. Click "Load unpacked" and select the folder above
echo [TomiHunt] ------------------------------------------------------------
echo.
echo [TomiHunt] Already loaded this folder before? Just click the refresh icon
echo [TomiHunt] on the TomiHunt card - the path never changes, so your API key,
echo [TomiHunt] resume and settings are all still there.
echo.
echo [TomiHunt] Loaded the extension from some OTHER folder before (an older
echo [TomiHunt] release folder, a copy in Downloads)? That copy is stranded:
echo [TomiHunt] it lives outside the path above, no App update ever reaches it,
echo [TomiHunt] and if you loaded our release folder itself it holds no
echo [TomiHunt] manifest.json (the real one is in its "extension" subfolder), so
echo [TomiHunt] the browser reports it as broken. Remove that card first, then
echo [TomiHunt] load the folder above.
echo.
pause
endlocal
