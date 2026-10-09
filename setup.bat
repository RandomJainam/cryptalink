@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "LOG=%~dp0setup.log"
set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
set "PYTHON_CMD="
set "FRONTEND_MODE=1"
set "ABORTED="
> "%LOG%" echo CryptaLink setup started %date% %time%

echo [1/9] Environment check ...
if /i not "%OS%"=="Windows_NT" call :abort "Windows is required." "Run this installer on Windows 10 or 11."
if defined ABORTED goto :fatal_exit
if not exist requirements.txt call :abort "requirements.txt is missing." "Restore the project files and run setup.bat from the project folder."
if defined ABORTED goto :fatal_exit
if not exist config.py call :abort "config.py is missing." "Restore the project files and run setup.bat from the project folder."
if defined ABORTED goto :fatal_exit
call :ok 1 "Environment check"

echo [2/9] Runtime versions ...
where python >nul 2>&1
if not errorlevel 1 (
  python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
  where py >nul 2>&1
  if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=py -3"
  )
)
if not defined PYTHON_CMD call :abort "Python 3.11 or later was not found." "Install Python 3.11+ from https://www.python.org/downloads/windows/ and enable the Python launcher or add Python to PATH."
if defined ABORTED goto :fatal_exit
for /f "delims=" %%V in ('%PYTHON_CMD% -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"') do set "PYTHON_VERSION=%%V"
echo Python %PYTHON_VERSION% selected.
if exist frontend\package.json (
  where node >nul 2>&1
  if errorlevel 1 goto :node_missing
  for /f "delims=" %%V in ('node --version') do set "NODE_VERSION=%%V"
  set "NODE_MAJOR=!NODE_VERSION:~1!"
  for /f "tokens=1 delims=." %%V in ("!NODE_MAJOR!") do set "NODE_MAJOR=%%V"
  if not defined NODE_MAJOR call :abort "Could not read the Node.js version." "Install Node.js 18+ from https://nodejs.org/en/download and reopen this terminal."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
  if !NODE_MAJOR! LSS 18 goto :node_missing
  where npm.cmd >nul 2>&1
  if errorlevel 1 goto :node_missing
  echo Node.js !NODE_VERSION! and npm.cmd found.
)
goto :runtime_ok

:node_missing
echo Node.js 18+ and npm.cmd are needed only for the React frontend.
echo Install Node.js from https://nodejs.org/en/download to run the full app.
choice /C YN /M "Continue with backend-only setup"
if errorlevel 2 call :abort "Frontend runtime is unavailable." "Install Node.js 18+ and npm.cmd, then rerun setup.bat."
if defined ABORTED goto :fatal_exit
set "FRONTEND_MODE=0"
:runtime_ok
call :ok 2 "Runtime versions"

echo [3/9] Virtual environment and dependencies ...
if not exist "%VENV_PYTHON%" (
  call %PYTHON_CMD% -m venv .venv >nul 2>&1
  if errorlevel 1 call :abort "Virtual environment creation failed." "Install Python 3.11+ with venv support, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
if not exist "%VENV_PYTHON%" call :abort "The virtual environment is incomplete." "Run setup.bat again; if .venv is damaged, rename it and rerun setup.bat."
if defined ABORTED goto :fatal_exit
"%VENV_PYTHON%" -m pip install -r requirements.txt >nul 2>&1
if errorlevel 1 call :abort "Python dependency installation failed." "Check your internet connection and requirements.txt, then rerun setup.bat."
if defined ABORTED goto :fatal_exit
call :ok 3 "Virtual environment and dependencies"

echo [4/9] Configuration ...
if not exist .env (
  if not exist .env.example call :abort ".env.example is missing." "Restore .env.example, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
  copy /y .env.example .env >> "%LOG%" 2>&1
  if errorlevel 1 call :abort "Could not create .env." "Check write access to the project folder, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
echo KEY_PASSPHRASE in .env is optional.
call :ok 4 "Configuration"

echo [5/9] Keys and storage ...
if not exist storage\received mkdir storage\received
if errorlevel 1 call :abort "Could not create storage\received." "Check write access to the project folder, then rerun setup.bat."
if defined ABORTED goto :fatal_exit
if not exist storage\logs mkdir storage\logs
if errorlevel 1 call :abort "Could not create storage\logs." "Check write access to the project folder, then rerun setup.bat."
if defined ABORTED goto :fatal_exit
if not exist keys\server_private.pem (
  if exist keys\server_public.pem call :abort "A public key exists without its private key." "Restore the matching keys\server_private.pem; setup will not overwrite the existing public key."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
  "%VENV_PYTHON%" scripts\gen_keys.py >> "%LOG%" 2>&1
  if errorlevel 1 call :abort "Server key generation failed." "Check write access to keys\ and rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
  echo A new server keypair was generated.
) else (
  if not exist keys\server_public.pem call :abort "The private key exists but the public key is missing." "Restore the matching keys\server_public.pem; setup will not replace or regenerate keys."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
  "%VENV_PYTHON%" -c "from config import PUBLIC_KEY_PATH; from crypto.keys import fingerprint, load_public; print('Server public-key SHA-256 fingerprint:', fingerprint(load_public(PUBLIC_KEY_PATH)))"
  if errorlevel 1 call :abort "Could not read the existing public key." "Restore the matching public key and check the optional passphrase in .env."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
echo Keep this keypair: client and server must use the same keys; do not delete keys while the app is in use.
call :ok 5 "Keys and storage"

echo [6/9] Frontend dependencies ...
if not exist frontend\package.json (
  echo No frontend package.json; frontend setup is not applicable.
) else if "%FRONTEND_MODE%"=="0" (
  echo SKIPPED in backend-only mode.
) else (
  if not exist frontend\node_modules (
    pushd frontend
    call npm.cmd install
    if errorlevel 1 call :abort "Frontend dependency installation failed." "Check your internet connection and frontend\package.json, then rerun setup.bat."
    if defined ABORTED goto :fatal_exit
    if defined ABORTED goto :fatal_exit
    popd
  )
  if not exist frontend\.env (
    if not exist frontend\.env.example call :abort "frontend\.env.example is missing." "Restore the frontend environment example, then rerun setup.bat."
    if defined ABORTED goto :fatal_exit
    if defined ABORTED goto :fatal_exit
    copy /y frontend\.env.example frontend\.env >> "%LOG%" 2>&1
    if errorlevel 1 call :abort "Could not create frontend\.env." "Check write access to frontend\, then rerun setup.bat."
    if defined ABORTED goto :fatal_exit
    if defined ABORTED goto :fatal_exit
    powershell -NoProfile -Command "$path = 'frontend/.env'; $content = [IO.File]::ReadAllText($path); if ($content -notmatch '(?m)^VITE_USE_MOCK=') { throw 'VITE_USE_MOCK is missing' }; $content = [regex]::Replace($content, '(?m)^VITE_USE_MOCK=.*$', 'VITE_USE_MOCK=false'); [IO.File]::WriteAllText($path, $content)" >> "%LOG%" 2>&1
    if errorlevel 1 call :abort "Could not configure frontend\.env." "Set VITE_USE_MOCK=false in frontend\.env, then rerun setup.bat."
    if defined ABORTED goto :fatal_exit
    if defined ABORTED goto :fatal_exit
  )
)
call :ok 6 "Frontend dependencies"

echo [7/9] Verification ...
"%VENV_PYTHON%" -m pytest -q -p no:cacheprovider >> "%LOG%" 2>&1
if errorlevel 1 call :abort "Backend verification failed." "Review setup.log for pytest output, fix the failing check, and rerun setup.bat."
if defined ABORTED goto :fatal_exit
call :ok 7 "Verification"

echo [8/9] Port check ...
call :check_port 9000
if errorlevel 1 (
  call :gateway_health
  if errorlevel 1 call :abort "Port 9000 is busy with an unverified service." "Close the other program using port 9000, or start the CryptaLink server and gateway, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
call :check_port 8000
if errorlevel 1 (
  call :gateway_health
  if errorlevel 1 call :abort "Port 8000 is busy with an unverified service." "Close the other program using port 8000, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
call :check_port 5173
if errorlevel 1 (
  curl.exe -fsS --max-time 2 http://localhost:5173/ | findstr /I /C:"CryptaLink" >nul
  if errorlevel 1 call :abort "Port 5173 is busy with an unverified service." "Close the other program using port 5173, then rerun setup.bat."
  if defined ABORTED goto :fatal_exit
  if defined ABORTED goto :fatal_exit
)
call :ok 8 "Port check"

if /i "%~1"=="/nolaunch" (
  echo Setup verification complete. Launch skipped by /nolaunch.
  exit /b 0
)
echo [9/9] Launch ...
if "%FRONTEND_MODE%"=="0" (
  call run.bat /backend-only
) else (
  call run.bat
)
if errorlevel 1 call :abort "Application launch failed." "Review the service window messages and setup.log, resolve the reported issue, then rerun setup.bat."
if defined ABORTED goto :fatal_exit
call :ok 9 "Launch"
exit /b 0

:check_port
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
exit /b %ERRORLEVEL%

:gateway_health
curl.exe -fsS --max-time 2 http://127.0.0.1:8000/api/status | findstr /C:"server_reachable" | findstr /C:"true" >nul
exit /b %ERRORLEVEL%

:ok
echo [%~1/9] %~2 ... OK
>> "%LOG%" echo %date% %time% [%~1/9] %~2 ... OK
exit /b 0

:abort
set "ABORTED=1"
set "FAIL_REASON=%~1"
set "FAIL_FIX=%~2"
goto :setup_error

:setup_error
echo ERROR: %FAIL_REASON%
echo Fix: %FAIL_FIX%
>> "%LOG%" echo %date% %time% ERROR: %FAIL_REASON%
>> "%LOG%" echo Fix: %FAIL_FIX%
pause
exit /b 1

:fatal_exit
exit /b 1
