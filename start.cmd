@echo off
rem Porneste aplicatia (baza de date + versiunea optimizata). Ctrl+C sau inchiderea ferestrei o opreste.
cd /d "%~dp0"
if not exist node_modules (
  echo Proiectul nu este instalat. Ruleaza intai setup.cmd.
  pause
  exit /b 1
)
call npm run local:prod
pause
