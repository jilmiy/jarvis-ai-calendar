@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --no-audit --no-fund
)
start "" /min cmd /c "npx electron ."
