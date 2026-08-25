@echo off
setlocal
cd /d "%~dp0"
echo Starting Superpower DIY installer...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DIY-Install-Superpower.ps1"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Superpower installation failed with exit code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)
exit /b 0
