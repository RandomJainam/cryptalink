@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
  echo ERROR: The project virtual environment is missing.
  echo Fix: Run setup.bat first.
  pause
  exit /b 1
)

call :port_busy 9000
if errorlevel 1 (
  echo Starting TCP server on port 9000...
  start "CryptaLink TCP Server" /D "%~dp0" cmd /k ""%PYTHON_EXE%" -m server.server"
) else (
  echo Port 9000 is already listening; not starting a duplicate TCP server.
)
set "SERVER_READY="
for /l %%I in (1,1,15) do (
  call :port_busy 9000
  if not errorlevel 1 (
    set "SERVER_READY=1"
    goto :server_ready
  )
  timeout /t 1 /nobreak >nul
)
:server_ready
if not defined SERVER_READY (
  echo ERROR: TCP server did not listen on port 9000 within 15 seconds.
  echo Fix: Check the TCP server window and close any unrelated process using port 9000.
  pause
  exit /b 1
)

call :port_busy 8000
if errorlevel 1 (
  echo Starting FastAPI gateway on port 8000...
  start "CryptaLink Gateway" /D "%~dp0" cmd /k ""%PYTHON_EXE%" -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000"
) else (
  echo Port 8000 is already listening; not starting a duplicate gateway.
)
set "GATEWAY_READY="
for /l %%I in (1,1,15) do (
  call :gateway_health
  if not errorlevel 1 (
    set "GATEWAY_READY=1"
    goto :gateway_ready
  )
  timeout /t 1 /nobreak >nul
)
:gateway_ready
if not defined GATEWAY_READY (
  echo ERROR: Gateway health check failed or the TCP server is unreachable.
  echo Fix: Check the gateway window and verify the TCP server is running on port 9000.
  pause
  exit /b 1
)
echo Gateway is healthy and the TCP server is reachable.

if /i "%~1"=="/backend-only" (
  echo Backend services are running. Frontend was skipped because Node.js is unavailable.
  echo Close the TCP Server and Gateway windows to stop CryptaLink.
  exit /b 0
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm.cmd is unavailable.
  echo Fix: Install Node.js 18+ and rerun setup.bat.
  pause
  exit /b 1
)
if not exist frontend\node_modules (
  echo ERROR: Frontend dependencies are missing.
  echo Fix: Run setup.bat to install frontend dependencies.
  pause
  exit /b 1
)
call :port_busy 5173
if errorlevel 1 (
  echo Starting React frontend on port 5173...
  start "CryptaLink Frontend" /D "%~dp0frontend" cmd /k "npm.cmd run dev"
) else (
  curl.exe -fsS --max-time 2 http://localhost:5173/ | findstr /I /C:"CryptaLink" >nul
  if errorlevel 1 (
    echo ERROR: Port 5173 is occupied by an unverified service.
    echo Fix: Close the other program using port 5173, then rerun run.bat.
    pause
    exit /b 1
  )
  echo Port 5173 is already serving CryptaLink; not starting a duplicate frontend.
)
start "" "http://localhost:5173"
echo CryptaLink is running. Close the TCP Server, Gateway, and Frontend windows to stop it.
exit /b 0

:port_busy
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %ERRORLEVEL%

:gateway_health
curl.exe -fsS --max-time 2 http://127.0.0.1:8000/api/status | findstr /C:"server_reachable" | findstr /C:"true" >nul
exit /b %ERRORLEVEL%
