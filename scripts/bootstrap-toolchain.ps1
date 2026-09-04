[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$nodeVersion = "24.20.0"
$expectedNpmVersion = "11.19.0"
$distributionName = "node-v$nodeVersion-win-x64"
$archiveName = "$distributionName.zip"
$distributionUrl = "https://nodejs.org/dist/v$nodeVersion"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $repositoryRoot ".tools"
$installationDirectory = Join-Path $toolsDirectory $distributionName
$nodePath = Join-Path $installationDirectory "node.exe"
$npmPath = Join-Path $installationDirectory "npm.cmd"

if (-not (Test-Path $nodePath) -or -not (Test-Path $npmPath)) {
    $archivePath = Join-Path $toolsDirectory $archiveName
    $checksumsPath = Join-Path $toolsDirectory "SHASUMS256.txt"
    $extractDirectory = Join-Path $toolsDirectory "$distributionName.partial"

    New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest "$distributionUrl/SHASUMS256.txt" -OutFile $checksumsPath
        Invoke-WebRequest "$distributionUrl/$archiveName" -OutFile $archivePath

        $checksumLine = Get-Content $checksumsPath |
            Where-Object { $_ -match "^[a-f0-9]{64}\s+$([regex]::Escape($archiveName))$" } |
            Select-Object -First 1

        if ($null -eq $checksumLine) {
            throw "Official checksum for $archiveName was not found."
        }

        $expectedChecksum = ($checksumLine -split "\s+")[0].ToUpperInvariant()
        $actualChecksum = (Get-FileHash $archivePath -Algorithm SHA256).Hash

        if ($actualChecksum -ne $expectedChecksum) {
            throw "SHA-256 mismatch for $archiveName."
        }

        Remove-Item $extractDirectory -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive $archivePath -DestinationPath $extractDirectory
        Remove-Item $installationDirectory -Recurse -Force -ErrorAction SilentlyContinue
        Move-Item (Join-Path $extractDirectory $distributionName) $installationDirectory
    }
    finally {
        Remove-Item $archivePath, $checksumsPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$installedNodeVersion = (& $nodePath --version).TrimStart("v")
$installedNpmVersion = (& $npmPath --version).Trim()

if ($installedNodeVersion -ne $nodeVersion) {
    throw "Expected Node.js $nodeVersion, found $installedNodeVersion."
}

if ($installedNpmVersion -ne $expectedNpmVersion) {
    throw "Expected npm $expectedNpmVersion, found $installedNpmVersion."
}

# Return only the absolute executable path so callers can safely capture it.
Write-Output $npmPath
