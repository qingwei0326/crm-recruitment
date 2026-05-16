Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(root, "start.ps1")
logFile = fso.BuildPath(root, "startup.log")
command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & script & Chr(34) & " >> " & Chr(34) & logFile & Chr(34) & " 2>&1"
shell.CurrentDirectory = root
shell.Run command, 0, False
