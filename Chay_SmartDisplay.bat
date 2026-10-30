@echo off
cd /d "%~dp0"
if exist "SmartDisplay.exe" (
    start "" "%~dp0SmartDisplay.exe"
) else if exist "dist\SmartDisplay.exe" (
    start "" "%~dp0dist\SmartDisplay.exe"
) else if exist "Chay_An_SmartDisplay.vbs" (
    start "" wscript.exe "%~dp0Chay_An_SmartDisplay.vbs"
)
exit
