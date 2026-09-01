[CmdletBinding()]
param([switch]$Help)

$ErrorActionPreference = 'Stop'
$NodeMinMajor = 24
$PnpmVersion = '11.19.0'
$TotalStages = 6
$StageIndex = 0
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $ProjectRoot '.rhiza'
$RuntimeDir = Join-Path $StateDir 'runtime'
$NodeHome = Join-Path $RuntimeDir 'node'
$ToolingDir = Join-Path $StateDir 'tooling'
$PidFile = Join-Path $StateDir 'rhiza.pid'
$LogFile = Join-Path $StateDir 'rhiza.log'
$ErrorLogFile = Join-Path $StateDir 'rhiza.error.log'
$EnvFile = Join-Path $ProjectRoot '.env'
$script:NodeExe = $null
$script:PnpmJs = $null
$script:PnpmExe = $null

if ($Help) {
  Write-Host 'Rhiza one-click deployment wizard (Windows)'
  Write-Host "`nUsage: powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1"
  exit 0
}

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Show-Stage([string]$Name) {
  $script:StageIndex++
  Write-Host "`n> Stage $script:StageIndex/$TotalStages - $Name" -ForegroundColor Cyan
}

function Read-YesNo([string]$Question) {
  return (Read-Host "$Question [y/N]") -match '^[Yy]$'
}

function Get-EnvValue([string]$Key) {
  if (-not (Test-Path $EnvFile)) { return '' }
  $line = Get-Content $EnvFile | Where-Object { $_ -match ('^' + [regex]::Escape($Key) + '=') } | Select-Object -Last 1
  if ($null -eq $line) { return '' }
  $value = $line.Substring($line.IndexOf('=') + 1)
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
    $value = $value.Substring(1, $value.Length - 2).Replace('\"', '"').Replace('\\', '\')
  }
  return $value
}

function Set-EnvValue([string]$Key, [string]$Value) {
  $lines = if (Test-Path $EnvFile) { @(Get-Content $EnvFile) } else { @() }
  $prefix = "$Key="
  $lines = @($lines | Where-Object { -not $_.StartsWith($prefix) })
  $lines += "$Key=$Value"
  Set-Content -Path $EnvFile -Value $lines -Encoding utf8
  Write-Host "  Wrote $Key to .env" -ForegroundColor Green
}

function Set-EnvStringValue([string]$Key, [string]$Value) {
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
  Set-EnvValue $Key ('"' + $escaped + '"')
}

function Remove-EnvValue([string]$Key) {
  if (-not (Test-Path $EnvFile)) { return }
  $prefix = "$Key="
  $lines = @(Get-Content $EnvFile | Where-Object { -not $_.StartsWith($prefix) })
  Set-Content -Path $EnvFile -Value $lines -Encoding utf8
  Write-Host "  Removed $Key from .env."
}

function Ensure-EnvFile {
  if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $ProjectRoot '.env.example') $EnvFile
    Write-Host '  Created .env from .env.example.'
  }
}

function Get-ConfiguredPort {
  $port = Get-EnvValue 'API_PORT'
  if ($port -notmatch '^\d+$') { return 8787 }
  return [int]$port
}

function Test-RhizaProcess([int]$ProcessId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    return $process.CommandLine -match 'dist-server[\\/]index\.js'
  } catch { return $false }
}

function Test-RhizaHealth([int]$Port) {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/api/health" | Out-Null
    return $true
  } catch { return $false }
}

function Test-PortInUse([int]$Port) {
  try { return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1) }
  catch { return $false }
}

function Find-RhizaService {
  if (Test-Path $PidFile) {
    $savedPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($savedPid -match '^\d+$' -and (Test-RhizaProcess ([int]$savedPid))) { return [int]$savedPid }
    Set-Content $PidFile ''
  }
  $port = Get-ConfiguredPort
  if (-not (Test-RhizaHealth $port)) { return $null }
  try {
    $owner = Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object -First 1 -ExpandProperty OwningProcess
    if ($owner -and (Test-RhizaProcess $owner)) {
      Set-Content $PidFile $owner
      return [int]$owner
    }
  } catch {}
  return -1
}

function Stop-RhizaService([int]$ProcessId) {
  Write-Host "  Stopping Rhiza (PID $ProcessId)..."
  Stop-Process -Id $ProcessId
  try { Wait-Process -Id $ProcessId -Timeout 5 -ErrorAction Stop } catch {
    Write-Warning "The service did not stop within 5 seconds. Stop PID $ProcessId manually."
    throw
  }
  Set-Content $PidFile ''
  Write-Host '  Rhiza has stopped.' -ForegroundColor Green
}

function Resolve-Toolchain {
  $script:NodeExe = $null; $script:PnpmJs = $null; $script:PnpmExe = $null
  $portableNode = Join-Path $NodeHome 'node.exe'
  $localPnpm = Join-Path $ToolingDir 'node_modules/pnpm/bin/pnpm.cjs'
  if (Test-Path $portableNode) { $script:NodeExe = $portableNode }
  else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $script:NodeExe = $nodeCommand.Source }
  }
  if (Test-Path $localPnpm) { $script:PnpmJs = $localPnpm }
  else {
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $pnpmCommand) { $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue }
    if ($pnpmCommand) { $script:PnpmExe = $pnpmCommand.Source }
  }
}

function Test-CompatibleNode {
  if (-not $script:NodeExe) { return $false }
  try { return [int](& $script:NodeExe -p 'Number(process.versions.node.split(".")[0])') -ge $NodeMinMajor }
  catch { return $false }
}

function Invoke-Pnpm {
  if ($script:PnpmJs) { & $script:NodeExe $script:PnpmJs @args }
  else { & $script:PnpmExe @args }
  if ($LASTEXITCODE -ne 0) { throw "pnpm failed with exit code $LASTEXITCODE" }
}

function Test-CompatiblePnpm {
  if (-not $script:NodeExe -or (-not $script:PnpmJs -and -not $script:PnpmExe)) { return $false }
  try { return ((Invoke-Pnpm --version) | Select-Object -Last 1) -eq $PnpmVersion }
  catch { return $false }
}

function Install-PortableNode {
  $architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw "Unsupported CPU architecture: $env:PROCESSOR_ARCHITECTURE" }
  }
  $baseUrl = "https://nodejs.org/dist/latest-v$NodeMinMajor.x"
  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ("rhiza-node-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    $checksumsPath = Join-Path $tempDir 'SHASUMS256.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksumsPath
    $match = Get-Content $checksumsPath | Where-Object { $_ -match ("  node-v.+-win-$architecture\.zip$") } | Select-Object -First 1
    if (-not $match) { throw "No Node.js archive found for win-$architecture" }
    $parts = $match -split '\s+'
    $expected = $parts[0]
    $fileName = $parts[-1]
    $archive = Join-Path $tempDir $fileName
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$fileName" -OutFile $archive
    $actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) { throw 'Node.js archive checksum mismatch.' }
    Expand-Archive -Path $archive -DestinationPath $tempDir
    $extracted = Join-Path $tempDir ([IO.Path]::GetFileNameWithoutExtension($fileName))
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    if (Test-Path $NodeHome) {
      $backup = Join-Path $RuntimeDir ("node.previous." + (Get-Date -Format 'yyyyMMddHHmmss'))
      Move-Item $NodeHome $backup
      Write-Host "  Previous portable Node.js moved to $backup"
    }
    Move-Item $extracted $NodeHome
    $script:NodeExe = Join-Path $NodeHome 'node.exe'
    Write-Host "  Installed $(& $script:NodeExe --version) in $NodeHome" -ForegroundColor Green
  } finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
  }
}

function Install-LocalPnpm {
  New-Item -ItemType Directory -Force -Path $ToolingDir | Out-Null
  $portableNpm = Join-Path $NodeHome 'node_modules/npm/bin/npm-cli.js'
  if ($script:NodeExe -eq (Join-Path $NodeHome 'node.exe') -and (Test-Path $portableNpm)) {
    & $script:NodeExe $portableNpm install --prefix $ToolingDir "pnpm@$PnpmVersion"
  } else {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
      Install-PortableNode
      $portableNpm = Join-Path $NodeHome 'node_modules/npm/bin/npm-cli.js'
      & $script:NodeExe $portableNpm install --prefix $ToolingDir "pnpm@$PnpmVersion"
    } else { & $npmCommand.Source install --prefix $ToolingDir "pnpm@$PnpmVersion" }
  }
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install pnpm.' }
  $script:PnpmJs = Join-Path $ToolingDir 'node_modules/pnpm/bin/pnpm.cjs'
  Write-Host "  Installed pnpm $(Invoke-Pnpm --version) in $ToolingDir" -ForegroundColor Green
}

Show-Stage 'Check running service'
$servicePid = Find-RhizaService
if ($servicePid -eq -1) {
  Write-Warning "Rhiza answered on port $(Get-ConfiguredPort), but its PID could not be verified safely."
  do { $serviceAction = Read-Host 'Choose: [1] restart service  [2] stop service' } until ($serviceAction -in @('1', '2'))
  Write-Warning 'This service was not started by the deployment wizard, so it will not be terminated automatically.'
  Read-Host 'Stop it from its original terminal, then press Enter to exit'
  exit 1
}
if ($servicePid) {
  do { $serviceAction = Read-Host 'Choose: [1] restart service  [2] stop service' } until ($serviceAction -in @('1', '2'))
  Stop-RhizaService $servicePid
  if ($serviceAction -eq '2') { Write-Host 'Rhiza is stopped.' -ForegroundColor Green; exit 0 }
} else { Write-Host '  No running Rhiza service was found.' }

Show-Stage 'Check runtime requirements'
Resolve-Toolchain
$missing = @()
if (-not (Test-CompatibleNode)) { $missing += "Node.js $NodeMinMajor+" }
if (-not (Test-CompatiblePnpm)) { $missing += "pnpm $PnpmVersion" }
if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules/.modules.yaml'))) { $missing += 'project dependencies' }
if ($missing.Count -gt 0) {
  Write-Warning ("Missing or incompatible: " + ($missing -join ', '))
  if (-not (Read-YesNo 'Install the required environment inside this project now?')) {
    Write-Warning 'The runtime requirements are not satisfied.'
    Read-Host 'Press Enter to exit'
    exit 1
  }
  if (-not (Test-CompatibleNode)) { Install-PortableNode }
  Resolve-Toolchain
  if (-not (Test-CompatiblePnpm)) { Install-LocalPnpm }
  Write-Host '  Installing project dependencies...'
  Invoke-Pnpm install --frozen-lockfile
  Resolve-Toolchain
} else { Write-Host "  Runtime ready: $(& $script:NodeExe --version), pnpm $(Invoke-Pnpm --version)." -ForegroundColor Green }

Show-Stage 'Choose whether to start'
if (-not (Read-YesNo 'Start Rhiza now?')) { Write-Host 'Environment is ready. No service was started.'; exit 0 }

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Read-WithDefault([string]$Prompt, [string]$Default) {
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}

function Configure-Custom {
  while ($true) {
    $currentPort = Get-EnvValue 'API_PORT'; if (-not $currentPort) { $currentPort = '8787' }
    do {
      $apiPort = Read-WithDefault 'API port' $currentPort
      $validPort = $apiPort -match '^\d+$' -and [int]$apiPort -ge 1024 -and [int]$apiPort -le 65535
      if (-not $validPort) { Write-Warning 'Port must be an integer from 1024 to 65535.' }
    } until ($validPort)
    $configureAi = Read-YesNo 'Configure an AI provider now?'
    if ($configureAi) {
      $baseDefault = Get-EnvValue 'AI_BASE_URL'; if (-not $baseDefault) { $baseDefault = 'https://api.openai.com/v1' }
      $modelDefault = Get-EnvValue 'AI_MODEL'; if (-not $modelDefault) { $modelDefault = 'gpt-4.1-mini' }
      $nameDefault = Get-EnvValue 'AI_PROVIDER_NAME'; if (-not $nameDefault) { $nameDefault = 'OpenAI-compatible' }
      $aiBaseUrl = Read-WithDefault 'Provider base URL' $baseDefault
      $aiModel = Read-WithDefault 'Model name' $modelDefault
      $aiProviderName = Read-WithDefault 'Provider display name' $nameDefault
      $aiApiKey = Read-SecretText 'API key (hidden; Enter keeps current)'
      if (-not $aiApiKey) { $aiApiKey = Get-EnvValue 'AI_API_KEY' }
    }
    $externalDb = Read-YesNo 'Use an external PostgreSQL database?'
    if ($externalDb) {
      $databaseUrl = Read-SecretText 'PostgreSQL connection URL (hidden; Enter keeps current)'
      if (-not $databaseUrl) { $databaseUrl = Get-EnvValue 'DATABASE_URL' }
      if (-not $databaseUrl) { Write-Warning 'DATABASE_URL is empty; embedded PGlite will be used.'; $externalDb = $false }
    }
    Write-Host "`n  Configuration summary:"
    Write-Host "  API port: $apiPort"
    Write-Host $(if ($configureAi) { "  AI provider: $aiProviderName / $aiModel (key hidden)" } else { '  AI provider: keep current/default' })
    Write-Host $(if ($externalDb) { '  Database: external PostgreSQL (URL hidden)' } else { '  Database: embedded PGlite' })
    $review = Read-Host 'Choose: [1] confirm  [2] return to default settings  [3] edit again  [4] cancel'
    switch ($review) {
      '1' {
        Ensure-EnvFile
        Set-EnvValue 'API_PORT' $apiPort
        Set-EnvValue 'SERVE_FRONTEND' 'true'
        if ($configureAi) {
          Set-EnvStringValue 'AI_BASE_URL' $aiBaseUrl; Set-EnvStringValue 'AI_MODEL' $aiModel
          Set-EnvStringValue 'AI_PROVIDER_NAME' $aiProviderName; Set-EnvStringValue 'AI_API_KEY' $aiApiKey
        }
        if ($externalDb) { Set-EnvStringValue 'DATABASE_URL' $databaseUrl } else { Remove-EnvValue 'DATABASE_URL' }
        return 'confirmed'
      }
      '2' { return 'default' }
      '3' { continue }
      '4' { return 'cancelled' }
      default { Write-Warning 'Enter 1, 2, 3, or 4.' }
    }
  }
}

Show-Stage 'Configure Rhiza'
while ($true) {
  $configMode = Read-Host 'Choose: [1] default settings  [2] custom settings'
  if ($configMode -eq '1') { Ensure-EnvFile; Write-Host '  Using current .env values (or defaults from .env.example).'; break }
  if ($configMode -eq '2') {
    $result = Configure-Custom
    if ($result -eq 'confirmed') { break }
    if ($result -eq 'cancelled') { Write-Host 'Deployment cancelled.'; exit 0 }
    Write-Host '  Returned to configuration mode selection.'
  } else { Write-Warning 'Enter 1 or 2.' }
}

Show-Stage 'Build and start service'
Resolve-Toolchain
$port = Get-ConfiguredPort
if (Test-PortInUse $port) { Write-Warning "Port $port is already in use. Choose another API port and run the wizard again."; exit 1 }
Write-Host '  Creating a production build...'
Invoke-Pnpm run build
if (Get-EnvValue 'DATABASE_URL') { Write-Host '  Applying PostgreSQL migrations...'; Invoke-Pnpm run db:migrate }
Set-Content $LogFile ''
Set-Content $ErrorLogFile ''
$service = Start-Process -FilePath $script:NodeExe -ArgumentList 'dist-server/index.js' -WorkingDirectory $ProjectRoot -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
Set-Content $PidFile $service.Id
$started = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if (Test-RhizaHealth $port) { $started = $true; break }
  if ($service.HasExited) { break }
  Start-Sleep -Seconds 1
}
if (-not $started) {
  Write-Warning 'Rhiza did not become healthy. Recent log output:'
  Get-Content $LogFile, $ErrorLogFile -Tail 30 -ErrorAction SilentlyContinue
  exit 1
}

Show-Stage 'Deployment complete'
$url = "http://127.0.0.1:$port"
Write-Host "  Rhiza is running at $url" -ForegroundColor Green
Write-Host "  PID: $($service.Id)"
Write-Host "  Logs: $LogFile and $ErrorLogFile"
Start-Process $url
