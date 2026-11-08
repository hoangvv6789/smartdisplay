@echo off
chcp 65001 > nul
title SmartDisplay - Cài đặt tự động
color 0A

echo ============================================================
echo   SMARTDISPLAY ADB MANAGER - CÀI ĐẶT TỰ ĐỘNG
echo ============================================================
echo.

cd /d "%~dp0"

:: BƯỚC 1: Kiểm tra Node.js
echo [1/5] Kiểm tra Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ Chưa có Node.js! Đang tải Node.js Portable...
    echo   Vui lòng tải và cài Node.js từ: https://nodejs.org/
    echo   Sau đó chạy lại file này.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   ✅ Node.js %NODE_VER%

:: BƯỚC 2: Cài dependencies
echo [2/5] Cài đặt thư viện...
if not exist "node_modules" (
    call npm install --production
    if errorlevel 1 (
        echo   ❌ Lỗi cài thư viện!
        pause
        exit /b 1
    )
) else (
    echo   ✅ Đã có node_modules
)

:: BƯỚC 3: Đóng gói EXE
echo [3/5] Đóng gói file EXE...
if not exist "SmartDisplay_ADB_Manager.exe" (
    echo   Đang đóng gói (có thể mất 1-2 phút)...
    call npx pkg . --output SmartDisplay_ADB_Manager.exe --targets node18-win-x64
    if errorlevel 1 (
        echo   ⚠️  Không đóng gói được EXE, sẽ chạy trực tiếp bằng Node.js
    ) else (
        echo   ✅ Đã tạo SmartDisplay_ADB_Manager.exe
    )
) else (
    echo   ✅ Đã có SmartDisplay_ADB_Manager.exe
)

:: BƯỚC 4: Tạo shortcut khởi động cùng Windows
echo [4/5] Cài đặt tự khởi động cùng Windows...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_PATH=%~dp0Chay_An_SmartDisplay.vbs"

:: Tạo VBS launcher nếu chưa có
if not exist "%VBS_PATH%" (
    echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
    echo WshShell.CurrentDirectory = "%~dp0" >> "%VBS_PATH%"
    echo If CreateObject("Scripting.FileSystemObject").FileExists("%~dp0SmartDisplay_ADB_Manager.exe") Then >> "%VBS_PATH%"
    echo   WshShell.Run """%~dp0SmartDisplay_ADB_Manager.exe""", 0, False >> "%VBS_PATH%"
    echo Else >> "%VBS_PATH%"
    echo   WshShell.Run "cmd /c cd /d ""%~dp0"" && node server/server.js", 0, False >> "%VBS_PATH%"
    echo End If >> "%VBS_PATH%"
)

:: Copy VBS vào Startup folder
copy /Y "%VBS_PATH%" "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs" >nul 2>&1
if errorlevel 1 (
    echo   ⚠️  Không copy được vào Startup (thử chạy bằng quyền Admin)
) else (
    echo   ✅ Đã thêm vào Startup - tự chạy khi bật máy
)

:: BƯỚC 5: Khởi động ngay
echo [5/5] Khởi động SmartDisplay...
start "" wscript.exe "%VBS_PATH%"
timeout /t 2 >nul
start "" "http://localhost:8686"

echo.
echo ============================================================
echo   ✅ CÀI ĐẶT HOÀN TẤT!
echo   🌐 Mở trình duyệt: http://localhost:8686
echo   🔄 Tự khởi động cùng Windows (không hiện cửa sổ)
echo   🛑 Để tắt: chạy Tat_SmartDisplay.bat
echo ============================================================
echo.
pause
