@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PIRAIDERS_BUNDLE_ROOT=%~dp0"
if not "%~1"=="" (
  echo Verify-PiRaiders.cmd takes no arguments. Read OPERATOR-CHECKLIST.md.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" (
  echo Bundled Node runtime is missing. Extract a complete bundle.
  exit /b 2
)
"%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\scripts\piraiders-verify-bundle.cjs"
exit /b %ERRORLEVEL%
