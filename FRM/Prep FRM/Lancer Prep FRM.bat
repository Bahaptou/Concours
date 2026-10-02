@echo off
rem Starts Prep FRM: local server + browser. Closing this window stops the server.
rem cd first: "%~dp0" ends with a backslash, which escapes the closing quote of an argument.
chcp 65001 >nul
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
  echo uv n est pas installe. Voir le README : section Installation.
  pause
  exit /b 1
)
uv run python server.py %*
if errorlevel 1 pause
