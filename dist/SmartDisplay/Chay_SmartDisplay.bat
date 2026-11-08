@echo off
chcp 65001 > nul
title SmartDisplay - Chay nhanh
cd /d "%~dp0"

node --version >nul 2>&1
if errorlevel 1 (
    echo   [X] Can cai Node.js: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo   Dang cai thu vien...
    call npm install --production
)

start "" wscript.exe "%~dp0Chay_An_SmartDisplay.vbs"

echo   [OK] SmartDisplay dang chay!
echo   Mo: http://localhost:8686
timeout /t 2 >nul
start "" "http://localhost:8686"
