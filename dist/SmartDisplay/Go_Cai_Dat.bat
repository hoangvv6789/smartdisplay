@echo off
chcp 65001 > nul
title Go cai dat SmartDisplay
color 0C
echo.
echo   GO CAI DAT SMARTDISPLAY...
echo.

taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM SmartDisplay.exe 2>nul

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs" (
    del /f "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs"
    echo   [OK] Da xoa khoi Startup
) else (
    echo   [i] Khong co trong Startup
)

echo.
echo   [OK] Da go cai dat! (Folder app van giu nguyen, xoa tay neu muon)
echo.
pause
