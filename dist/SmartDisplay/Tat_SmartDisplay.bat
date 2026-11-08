@echo off
title Tat SmartDisplay
echo.
echo   Dang tat SmartDisplay...
taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM node.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8686 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo   [OK] Da tat xong!
timeout /t 2 >nul
