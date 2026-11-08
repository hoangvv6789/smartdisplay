Set WshShell = CreateObject("WScript.Shell")
currentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

' Ưu tiên chạy EXE nếu có, không thì chạy bằng Node.js
If CreateObject("Scripting.FileSystemObject").FileExists(currentDir & "\SmartDisplay_ADB_Manager.exe") Then
    WshShell.Run """SmartDisplay_ADB_Manager.exe""", 0, False
ElseIf CreateObject("Scripting.FileSystemObject").FileExists(currentDir & "\dist\SmartDisplay_ADB_Manager.exe") Then
    WshShell.Run """dist\SmartDisplay_ADB_Manager.exe""", 0, False
Else
    WshShell.Run "cmd /c cd /d """ & currentDir & """ && node server/server.js", 0, False
End If

' Đợi server khởi động rồi mở trình duyệt
WScript.Sleep 2000
WshShell.Run "http://localhost:8686"
