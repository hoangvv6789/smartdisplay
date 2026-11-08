@echo off
title SmartDisplay - Setup
color 0A

echo ============================================
echo    SMARTDISPLAY ADB MANAGER - SETUP
echo ============================================
echo.

cd /d "%~dp0"

echo [1] Checking Node.js...
node -v 2>nul
if errorlevel 1 goto NO_NODE
echo [OK] Node.js found
echo.

echo [2] Installing dependencies...
if exist "node_modules" goto SKIP_NPM
call npm install --production --no-audit --no-fund
if errorlevel 1 goto NPM_FAIL
echo [OK] Done
echo.

:SKIP_NPM
echo [3] Setting up Windows auto-start...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

(
echo Set o = CreateObject^("WScript.Shell"^)
echo o.CurrentDirectory = "%~dp0"
echo o.Run "node server/server.js", 0, False
) > "%~dp0AutoStart.vbs"

copy /Y "%~dp0AutoStart.vbs" "%STARTUP%\SmartDisplay.vbs" >nul 2>&1
if errorlevel 1 goto STARTUP_FAIL
echo [OK] Added to Windows Startup
echo.

echo [4] Starting SmartDisplay...
start "" wscript.exe "%~dp0AutoStart.vbs"
timeout /t 3 >nul
start "" "http://localhost:8686"

echo.
echo ============================================
echo    [OK] SETUP COMPLETE!
echo.
echo    Open browser: http://localhost:8686
echo    Auto-start with Windows: YES
echo.
echo    To STOP:   run Tat_SmartDisplay.bat
echo    To REMOVE: run Go_Cai_Dat.bat
echo ============================================
goto END

:NO_NODE
echo.
echo [X] Node.js not found!
echo Please install Node.js LTS from: https://nodejs.org/
echo Then run this file again.
echo.
goto END

:NPM_FAIL
echo.
echo [X] npm install failed! Check your internet connection.
echo.
goto END

:STARTUP_FAIL
echo [!] Cannot copy to Startup folder
echo Try running this file as Administrator
echo.

:END
echo.
pause
