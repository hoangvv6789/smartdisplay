@echo off
title Go cai dat SmartDisplay
echo.
echo   Dang go cai dat SmartDisplay...

taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM node.exe 2>nul

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\SmartDisplay.vbs" (
    del /f "%STARTUP%\SmartDisplay.vbs"
    echo   [OK] Da xoa khoi Startup
) else (
    echo   [i] Khong co trong Startup
)

echo   [OK] Da go xong!
pause
