Set WshShell = CreateObject("WScript.Shell")
currentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

targetExe = "SmartDisplay_ADB_Manager.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(currentDir & "\" & targetExe) Then
    targetExe = "dist\SmartDisplay_ADB_Manager.exe"
End If

WshShell.Run """" & targetExe & """", 0, False
WScript.Sleep 1200
WshShell.Run "http://localhost:8686"
