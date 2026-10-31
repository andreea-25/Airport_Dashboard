@echo off
rem Instalare (o singura data, dupa git clone). Dublu-click pe acest fisier.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nu este instalat. Instaleaza varianta LTS de pe https://nodejs.org si ruleaza din nou.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\setup.mjs
pause
