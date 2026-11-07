@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   StudyPath - Google OAuth Setup
echo ============================================================
echo.
echo   You will be asked for 2 values from Google Cloud Console:
echo     1) Client ID
echo     2) Client secret
echo.
echo   The secret will NOT be shown on screen while you type.
echo.
echo ============================================================
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0set-google-oauth.ps1"
echo.
echo ------------------------------------------------------------
echo   If you see a green "saved" message above, you are done.
echo   Now go back to OpenCode and tell it to restart the backend.
echo ------------------------------------------------------------
echo.
pause