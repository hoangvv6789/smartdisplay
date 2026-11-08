@echo off
chcp 65001 > nul
title Tat SmartDisplay
echo.
echo   Dang tat SmartDisplay ADB Manager...
taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM SmartDisplay.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8686 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo.
echo   [OK] Da tat thanh cong!
timeout /t 2 >nul
