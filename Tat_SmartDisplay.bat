@echo off
chcp 65001 > nul
echo ======================================================
echo   Đang tắt SmartDisplay ADB Manager...
echo ======================================================
taskkill /F /IM SmartDisplay_ADB_Manager.exe 2>nul
taskkill /F /IM SmartDisplay.exe 2>nul
echo.
echo ✅ Đã tắt ứng dụng thành công!
timeout /t 2 >nul
