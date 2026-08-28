Set WshShell = CreateObject("WScript.Shell")
BackendDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & BackendDir & "\watch_server.ps1""", 0, False
