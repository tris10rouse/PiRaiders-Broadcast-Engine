@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PIRAIDERS_BUNDLE_ROOT=%~dp0"
set "PIRAIDERS_BUNDLE_BROWSER="
if "%~1"=="--no-browser" set "PIRAIDERS_BUNDLE_BROWSER=--no-browser"
if not "%~1"=="" if not "%~1"=="--no-browser" (
  echo Only the optional --no-browser argument is supported. Read README-WINDOWS.md.
  exit /b 2
)
if not "%~2"=="" (
  echo Only the optional --no-browser argument is supported. Read README-WINDOWS.md.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" (
  echo Bundled Node runtime is missing. Extract a complete development bundle.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json" (
  echo Application configuration is missing. Read README-WINDOWS.md before starting.
  echo Copy app\config\piraiders-app.example.json and configure the local workstation.
  exit /b 2
)
pushd "%PIRAIDERS_BUNDLE_ROOT%app" || exit /b 2
"%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\scripts\piraiders-app.cjs" "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json" %PIRAIDERS_BUNDLE_BROWSER%
set "PIRAIDERS_BUNDLE_EXIT=%ERRORLEVEL%"
popd
exit /b %PIRAIDERS_BUNDLE_EXIT%
