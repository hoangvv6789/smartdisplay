@echo off
chcp 65001 > nul
title Gỡ cài đặt SmartDisplay
color 0C
echo.
echo   GỠ CÀI ĐẶT SMARTDISPLAY...
echo.

:: Tắt app trước
taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM SmartDisplay.exe 2>nul

:: Xóa khỏi Startup
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs" (
    del /f "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs"
    echo   ✅ Đã xóa khỏi Startup
) else (
    echo   ℹ️  Không có trong Startup
)

echo.
echo   ✅ Đã gỡ cài đặt! (Folder app vẫn giữ nguyên, xóa tay nếu muốn)
echo.
pause
