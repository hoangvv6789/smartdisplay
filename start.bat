@echo off
title SmartDisplay ADB Manager
echo ===================================================
echo     SmartDisplay ADB Manager - Hong Ngoc Hospital
echo ===================================================
echo Dang khoi dong may chu tren cong 8686...

if exist "dist\SmartDisplay_ADB_Manager.exe" (
    start "" "dist\SmartDisplay_ADB_Manager.exe"
) else (
    start "" node server\server.js
)

timeout /t 2 /nobreak >nul
start http://localhost:8686
echo May chu da khoi dong. Trinh duyet dang duoc mo tai http://localhost:8686
