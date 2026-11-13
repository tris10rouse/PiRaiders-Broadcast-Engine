@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PIRAIDERS_BUNDLE_ROOT=%~dp0"
if not exist "%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" (
  echo Bundled Node runtime is missing. Extract a complete development bundle.
  exit /b 2
)
if not exist "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-launcher.json" (
  echo Launcher configuration is missing. Read README-WINDOWS.md before starting.
  echo Copy app\config\piraiders-launcher.example.json and configure an off-air test window.
  exit /b 2
)
pushd "%PIRAIDERS_BUNDLE_ROOT%app" || exit /b 2
"%PIRAIDERS_BUNDLE_ROOT%runtime\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\scripts\piraiders-launcher.cjs" "%PIRAIDERS_BUNDLE_ROOT%app\config\piraiders-launcher.json"
set "PIRAIDERS_BUNDLE_EXIT=%ERRORLEVEL%"
popd
exit /b %PIRAIDERS_BUNDLE_EXIT%
