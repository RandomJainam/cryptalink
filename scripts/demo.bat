@echo off
setlocal
if "%~1"=="" (
  echo Usage: scripts\demo.bat ^<file^>
  exit /b 2
)
pushd "%~dp0.."
if not exist keys\server_private.pem python scripts\gen_keys.py
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "$listener = Get-NetTCPConnection -LocalPort 9000 -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { Start-Process -WindowStyle Hidden -FilePath python -ArgumentList @('-m','server.server') -WorkingDirectory (Get-Location).Path }"
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
python -m client.attacks demo "%~1"
set DEMO_RESULT=%ERRORLEVEL%
python scripts\verify_log.py
if errorlevel 1 set DEMO_RESULT=1
popd
exit /b %DEMO_RESULT%
