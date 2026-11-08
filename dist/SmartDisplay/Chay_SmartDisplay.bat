@echo off
title SmartDisplay - Chay nhanh
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo   [X] Can cai Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo   Dang cai thu vien...
    call npm install --production --no-audit --no-fund
)

echo   Dang khoi dong SmartDisplay...
start "" wscript.exe "%~dp0AutoStart.vbs"
timeout /t 2 >nul
start "" "http://localhost:8686"

echo   [OK] SmartDisplay dang chay o: http://localhost:8686
pause
