@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PIRAIDERS_BUNDLE_ROOT=%~dp0"
set "PIRAIDERS_SETUP_PIN="
if "%~1"=="--pin-offline" set "PIRAIDERS_SETUP_PIN=--pin-offline"
if not "%~1"=="" if not "%~1"=="--pin-offline" (
  echo Only the optional --pin-offline argument is supported. Read README-WINDOWS.md.
  exit /b 2
)
if not "%~2"=="" (
  echo Only the optional --pin-offline argument is supported. Read README-WINDOWS.md.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" (
  echo Bundled Node runtime is missing. Extract a complete bundle.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json" (
  echo Application configuration is missing. Read README-WINDOWS.md before starting.
  exit /b 2
)
pushd "%PIRAIDERS_BUNDLE_ROOT%app" || exit /b 2
"%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\scripts\piraiders-setup.cjs" --machine "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json" %PIRAIDERS_SETUP_PIN%
set "PIRAIDERS_BUNDLE_EXIT=%ERRORLEVEL%"
popd
exit /b %PIRAIDERS_BUNDLE_EXIT%
