@echo off
chcp 65001 > nul
title Tắt SmartDisplay
echo.
echo   Đang tắt SmartDisplay ADB Manager...
taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM SmartDisplay.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8686 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo.
echo   ✅ Đã tắt thành công!
timeout /t 2 >nul
