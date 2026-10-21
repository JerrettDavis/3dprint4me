param(
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$PrivateRoot,
  [Parameter(Mandatory=$true)][string]$Config,
  [switch]$Apply,
  [switch]$Interactive,
  [switch]$PasswordLogon
)
$ErrorActionPreference='Stop'
if($Interactive -and $PasswordLogon){throw 'Select one task logon mode'}
$root=(Resolve-Path -LiteralPath $PrivateRoot).Path
$pythonPath=(Resolve-Path -LiteralPath $Python).Path
$configPath=(Resolve-Path -LiteralPath $Config).Path
if($root -eq [IO.Path]::GetPathRoot($root)){throw 'Explicit private application root required'}
$permissionCheck=@'
import importlib.util,sys,pathlib
s=importlib.util.spec_from_file_location("backup",sys.argv[1])
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)
m.private(pathlib.Path(sys.argv[2]))
m.private(pathlib.Path(sys.argv[3]))
'@
$permissionCheck | & $pythonPath - (Join-Path $PSScriptRoot 'backup-controller.py') $root $configPath
if($LASTEXITCODE -ne 0){throw 'Private recovery permissions required'}
$destination=Join-Path $root 'automation/3dprint4me'
$taskName='3dprint4me-encrypted-backup'
if(-not $Apply){[pscustomobject]@{Task=$taskName;Destination=$destination;Interval='Hourly';Logon=$(if($PasswordLogon){'Password owner account'}elseif($Interactive){'Interactive owner account'}else{'S4U owner account'});Apply=$false};exit}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach($file in @('backup-controller.py','export-backup.py','restore-drill.py')){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $destination $file) -Force
}
$script=Join-Path $destination 'backup-controller.py'
$action=New-ScheduledTaskAction -Execute $pythonPath -Argument ('"'+$script+'" --config "'+$configPath+'"') -WorkingDirectory $destination
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logon=if($Interactive){'Interactive'}else{'S4U'}
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType $logon -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if($PasswordLogon){
  $credential=Get-Credential -UserName $identity -Message 'Enter your Windows account password locally for the hourly backup task. Do not enter it in chat. Windows Task Scheduler stores it; source and configuration files do not.'
  if(-not $credential){throw 'Task registration cancelled'}
  $credentialSid=([System.Security.Principal.NTAccount]::new($credential.UserName)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if($credentialSid -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Use the existing backup owner account'}
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Limited -Settings $settings -Description 'Private hourly off-host backup. Windows-managed account credential; no invoice dispatch.' -Force -ErrorAction Stop | Out-Null
  $credential=$null
}else{
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Private off-host 3dprint4me database/config backup and independent status heartbeat. No invoice dispatch.' -Force -ErrorAction Stop | Out-Null
}
Get-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
[pscustomobject]@{Task=$taskName;Installed=$true;Started=$true;Verified=$false;Note='Verify LastTaskResult=0 and fresh independent backup heartbeat before treating scheduling as proven.'}
