@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PIRAIDERS_BUNDLE_ROOT=%~dp0"
if not "%~1"=="" (
  echo Diagnose-PiRaiders.cmd takes no arguments. Read README-WINDOWS.md.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" (
  echo Bundled Node runtime is missing. Extract a complete bundle.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json" (
  echo Application configuration is missing. Read OPERATOR-CHECKLIST.md or README-WINDOWS.md first.
  exit /b 2
)
pushd "%PIRAIDERS_BUNDLE_ROOT%app" || exit /b 2
"%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\scripts\piraiders-diagnose.cjs" --machine "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-app.json"
set "PIRAIDERS_BUNDLE_EXIT=%ERRORLEVEL%"
popd
exit /b %PIRAIDERS_BUNDLE_EXIT%
