@echo off
rem StudyPath launcher - double-click this file to start the app.
rem Starts: backend API (3000), web/share server (8090), cloudflared tunnel, watchdog.
setlocal
cd /d "%~dp0"

echo ============================================
echo   StudyPath - starting the app
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-all.ps1"

rem Read the current public link (LINK.txt). Fall back to localhost if there is no tunnel.
set "LINK="
if exist "%~dp0LINK.txt" (
  for /f "usebackq delims=" %%L in ("%~dp0LINK.txt") do set "LINK=%%L"
)
echo %LINK% | findstr /b "https://" >nul
if errorlevel 1 set "LINK=http://localhost:8090"

echo.
echo ============================================
echo   Public link : %LINK%
echo   This PC     : http://localhost:8090
echo ============================================
echo.
echo Opening the app in your browser...
if /i "%~1"=="--no-open" goto skipopen
start "" "%LINK%"
:skipopen

echo The app keeps running in the background.
echo You can close this window.
ping -n 9 127.0.0.1 >nul
