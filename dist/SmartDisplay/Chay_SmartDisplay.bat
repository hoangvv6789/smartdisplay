@echo off
chcp 65001 > nul
title SmartDisplay - Chạy nhanh
cd /d "%~dp0"

:: Kiểm tra Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ Cần cài Node.js: https://nodejs.org/
    pause
    exit /b 1
)

:: Cài deps nếu chưa có
if not exist "node_modules" (
    echo   Đang cài thư viện...
    call npm install --production
)

:: Chạy ẩn (không hiện cửa sổ terminal)
start "" wscript.exe "%~dp0Chay_An_SmartDisplay.vbs"

echo   ✅ SmartDisplay đang chạy!
echo   🌐 Mở: http://localhost:8686
timeout /t 2 >nul
start "" "http://localhost:8686"
