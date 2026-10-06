$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pm2Command = Get-Command pm2 -ErrorAction Stop
$pm2Path = $pm2Command.Source
if (-not $pm2Path) {
  throw 'Could not locate the PM2 executable. Install PM2 globally, then rerun this script.'
}

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute $pm2Path `
  -Argument 'resurrect' `
  -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal `
  -UserId $user `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName 'MC Discord Bridge' `
  -Description 'Restore the saved MC Discord Bridge PM2 process list when this Windows user logs in.' `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Output "Registered 'MC Discord Bridge' to run at logon for $user."
Write-Output 'The task restores the process list saved by PM2; run npm run service:save after changing PM2 processes.'
