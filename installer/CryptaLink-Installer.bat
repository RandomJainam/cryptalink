@echo off
setlocal EnableExtensions
set "REPO_URL=https://github.com/RandomJainam/cryptalink.git"
set "BRANCH=main"
set "PROJECT_FOLDER=CryptaLink"

echo Project installer
echo Edit REPO_URL and BRANCH at the top of this file to select a repository and branch.
echo.
echo(%REPO_URL%| findstr /I /C:"PLACEHOLDER" >nul
if not errorlevel 1 (
  echo ERROR: REPO_URL still contains placeholder text.
  echo Fix: Edit REPO_URL at the top of this file and run it again.
  pause
  exit /b 1
)

set "DEFAULT_DIR=%USERPROFILE%\%PROJECT_FOLDER%"
set /p "INSTALL_INPUT=Install directory [%DEFAULT_DIR%]: "
if not defined INSTALL_INPUT set "INSTALL_INPUT=%DEFAULT_DIR%"
for %%I in ("%INSTALL_INPUT%") do set "INSTALL_DIR=%%~fI"

if exist "%INSTALL_DIR%\" (
  if exist "%INSTALL_DIR%\.git\" (
    where git >nul 2>&1
    if not errorlevel 1 (
      echo Updating the existing Git checkout...
      git -C "%INSTALL_DIR%" pull
      if errorlevel 1 goto :git_error
    ) else (
      echo Git is unavailable; refreshing project files using the public-repository ZIP fallback.
      goto :download_zip
    )
  ) else (
    echo The target folder exists without .git; reusing it without deleting files.
    goto :download_zip
  )
) else (
  where git >nul 2>&1
  if not errorlevel 1 (
    echo Cloning the project with Git...
    git clone --branch "%BRANCH%" "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 goto :git_error
  ) else (
    echo Git was not found. Trying the GitHub branch ZIP; this fallback works only for public repositories.
    goto :download_zip
  )
)
goto :setup_project

:download_zip
set "ZIP_BASE=%REPO_URL:.git=%"
set "ZIP_URL=%ZIP_BASE%/archive/refs/heads/%BRANCH%.zip"
set "ZIP_ROOT=%TEMP%\Project-Installer-%RANDOM%-%RANDOM%"
set "ZIP_FILE=%ZIP_ROOT%.zip"
mkdir "%ZIP_ROOT%" >nul 2>&1
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%'; Expand-Archive -LiteralPath '%ZIP_FILE%' -DestinationPath '%ZIP_ROOT%'"
if errorlevel 1 (
  echo ERROR: Could not download or expand the branch ZIP.
  echo Fix: Check the repository URL, branch, internet connection, and public access.
  pause
  exit /b 1
)
set "SOURCE_DIR="
for /d %%D in ("%ZIP_ROOT%\*") do set "SOURCE_DIR=%%~fD"
if not defined SOURCE_DIR (
  echo ERROR: The ZIP did not contain a project folder.
  pause
  exit /b 1
)
if not exist "%INSTALL_DIR%\" mkdir "%INSTALL_DIR%"
if errorlevel 1 (
  echo ERROR: Could not create the install directory.
  echo Fix: Choose a writable folder and run this installer again.
  pause
  exit /b 1
)
robocopy "%SOURCE_DIR%" "%INSTALL_DIR%" /E >nul
if errorlevel 8 (
  echo ERROR: Could not copy the downloaded project files.
  echo Fix: Check write access to the install folder and run this installer again.
  pause
  exit /b 1
)

:setup_project
if not exist "%INSTALL_DIR%\setup.bat" (
  echo ERROR: setup.bat was not found in the project folder.
  echo Fix: Check that REPO_URL and BRANCH point to the project root.
  pause
  exit /b 1
)
pushd "%INSTALL_DIR%"
call setup.bat
set "SETUP_RESULT=%ERRORLEVEL%"
popd
exit /b %SETUP_RESULT%

:git_error
echo ERROR: Git could not clone or update the repository.
echo Fix: Check Git, the repository URL, the branch name, and internet access.
pause
exit /b 1
