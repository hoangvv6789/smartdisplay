@echo off
chcp 65001 > nul
title SmartDisplay - Cai dat tu dong
color 0A

echo ============================================================
echo   SMARTDISPLAY ADB MANAGER - CAI DAT TU DONG
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/5] Kiem tra Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo   [X] Chua co Node.js!
    echo   Hay tai va cai Node.js tu: https://nodejs.org/
    echo   Sau do chay lai file nay.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   [OK] Node.js %NODE_VER%

echo [2/5] Cai dat thu vien...
if not exist "node_modules" (
    call npm install --production
    if errorlevel 1 (
        echo   [X] Loi cai thu vien!
        pause
        exit /b 1
    )
) else (
    echo   [OK] Da co node_modules
)

echo [3/5] Dong goi EXE...
if not exist "SmartDisplay_ADB_Manager.exe" (
    echo   Dang dong goi (co the mat 1-2 phut)...
    call npx pkg . --output SmartDisplay_ADB_Manager.exe --targets node18-win-x64
    if errorlevel 1 (
        echo   [!] Khong dong goi duoc EXE, se chay truc tiep bang Node.js
    ) else (
        echo   [OK] Da tao SmartDisplay_ADB_Manager.exe
    )
) else (
    echo   [OK] Da co SmartDisplay_ADB_Manager.exe
)

echo [4/5] Cai dat tu khoi dong cung Windows...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_PATH=%~dp0Chay_An_SmartDisplay.vbs"

if not exist "%VBS_PATH%" (
    echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
    echo WshShell.CurrentDirectory = "%~dp0" >> "%VBS_PATH%"
    echo If CreateObject("Scripting.FileSystemObject").FileExists("%~dp0SmartDisplay_ADB_Manager.exe") Then >> "%VBS_PATH%"
    echo   WshShell.Run """%~dp0SmartDisplay_ADB_Manager.exe""", 0, False >> "%VBS_PATH%"
    echo Else >> "%VBS_PATH%"
    echo   WshShell.Run "cmd /c cd /d ""%~dp0"" && node server/server.js", 0, False >> "%VBS_PATH%"
    echo End If >> "%VBS_PATH%"
)

copy /Y "%VBS_PATH%" "%STARTUP_FOLDER%\SmartDisplay_AutoStart.vbs" >nul 2>&1
if errorlevel 1 (
    echo   [!] Khong copy duoc vao Startup (thu chay bang quyen Admin)
) else (
    echo   [OK] Da them vao Startup - tu chay khi bat may
)

echo [5/5] Khoi dong SmartDisplay...
start "" wscript.exe "%VBS_PATH%"
timeout /t 2 >nul
start "" "http://localhost:8686"

echo.
echo ============================================================
echo   [OK] CAI DAT HOAN TAT!
echo   Mo trinh duyet: http://localhost:8686
echo   Tu khoi dong cung Windows (khong hien cua so)
echo   De tat: chay Tat_SmartDisplay.bat
echo ============================================================
echo.
pause
