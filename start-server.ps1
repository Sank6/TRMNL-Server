$workingDir = "C:\Users\Sankarsh\Documents\xteink-server"
$bunExe = "C:\Users\Sankarsh\.bun\bin\bun.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logFile = "$workingDir\server.log"

Set-Location $workingDir

"[$(Get-Date)] Building..." | Out-File $logFile -Encoding UTF8
& $bunExe run build >> $logFile 2>&1

"[$(Get-Date)] Starting server..." | Add-Content $logFile
& $nodeExe dist/server.js >> $logFile 2>&1
