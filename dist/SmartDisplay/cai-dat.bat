@echo off
title SmartDisplay ADB Manager - Setup
color 0A

echo ============================================================
echo   SMARTDISPLAY ADB MANAGER - CAI DAT
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/4] Kiem tra Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [X] CHUA CO NODE.JS!
    echo   Hay tai va cai Node.js LTS tu: https://nodejs.org/
    echo   Sau do chay lai file nay.
    echo.
    pause
    exit /b 1
)
echo   [OK] Node.js san sang
echo.

echo [2/4] Cai dat thu vien...
if exist "node_modules" (
    echo   [OK] Da co node_modules
) else (
    call npm install --production --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   [X] LOI CAI THU VIEN!
        echo.
        pause
        exit /b 1
    )
    echo   [OK] Da cai xong thu vien
)
echo.

echo [3/4] Cai dat tu khoi dong cung Windows...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "HERE=%~dp0"

echo Set WshShell = CreateObject("WScript.Shell") > "%HERE%AutoStart.vbs"
echo WshShell.CurrentDirectory = "%HERE%" >> "%HERE%AutoStart.vbs"
echo WshShell.Run "cmd /c cd /d ""%HERE%"" && node server/server.js", 0, False >> "%HERE%AutoStart.vbs"
echo WScript.Sleep 2000 >> "%HERE%AutoStart.vbs"
echo WshShell.Run "http://localhost:8686" >> "%HERE%AutoStart.vbs"

copy /Y "%HERE%AutoStart.vbs" "%STARTUP%\SmartDisplay.vbs" >nul 2>&1
if errorlevel 1 (
    echo   [!] Khong copy duoc vao Startup
    echo   Thu chay file nay bang quyen Administrator
) else (
    echo   [OK] Da them vao Startup folder
)
echo.

echo [4/4] Khoi dong SmartDisplay...
start "" wscript.exe "%HERE%AutoStart.vbs"

echo.
echo ============================================================
echo   [OK] CAI DAT XONG!
echo.
echo   SmartDisplay dang chay o: http://localhost:8686
echo   Tu khoi dong cung Windows (khong hien cua so)
echo.
echo   De TAT app:     chay Tat_SmartDisplay.bat
echo   De GO cai dat:  chay Go_Cai_Dat.bat
echo ============================================================
echo.
pause
