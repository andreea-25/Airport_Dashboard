@echo off
rem Gemini check without Node: curl.exe (built into Windows 10/11). Run from the project folder: scripts\ai-ping.cmd
for /f "tokens=2 delims==" %%a in ('findstr /b "GEMINI_API_KEY=" .env') do set KEY=%%~a
for %%m in (gemini-3.8-flash) do (
  echo.
  echo === %%m ===
  curl.exe -s -m 60 -w "\nHTTP %%{http_code} in %%{time_total}s\n" -H "x-goog-api-key: %KEY%" -H "Content-Type: application/json" --data-binary @scripts\ai-ping-body.json https://generativelanguage.googleapis.com/v1beta/models/%%m:generateContent
)
