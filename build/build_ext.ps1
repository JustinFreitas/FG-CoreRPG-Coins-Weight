$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$sourceDir = Split-Path -Parent $scriptDir
if (-not $sourceDir) { $sourceDir = (Get-Item -Path ".").FullName }
$stagingDir = "$sourceDir\build\out\staging"
$outputZip = "$sourceDir\build\out\FG-CoreRPG-Coins-Weight.zip"
$localExt = "$sourceDir\build\out\FG-CoreRPG-Coins-Weight.ext"
$fguExtensionsDir = Join-Path $env:APPDATA "SmiteWorks\Fantasy Grounds\extensions"
$fgcExtensionsDir = Join-Path $env:APPDATA "Fantasy Grounds\extensions"

# Clean up any existing staging/outputs
if (Test-Path $stagingDir) { Remove-Item -Recurse -Force $stagingDir }
if (Test-Path $outputZip) { Remove-Item -Force $outputZip }
$null = New-Item -ItemType Directory -Path $stagingDir -ErrorAction SilentlyContinue

# Copy extension root files
Copy-Item "$sourceDir\extension.xml" -Destination "$stagingDir\"
if (Test-Path "$sourceDir\LICENSE.md") {
    Copy-Item "$sourceDir\LICENSE.md" -Destination "$stagingDir\"
}
if (Test-Path "$sourceDir\README.md") {
    Copy-Item "$sourceDir\README.md" -Destination "$stagingDir\"
}

# Copy graphics files
if (Test-Path "$sourceDir\graphics") {
    $null = New-Item -ItemType Directory -Path "$stagingDir\graphics" -ErrorAction SilentlyContinue
    if (Test-Path "$sourceDir\graphics\icons") {
        $null = New-Item -ItemType Directory -Path "$stagingDir\graphics\icons" -ErrorAction SilentlyContinue
        Copy-Item "$sourceDir\graphics\icons\*" -Destination "$stagingDir\graphics\icons\"
    }
}

# Copy scripts (only .lua files)
$null = New-Item -ItemType Directory -Path "$stagingDir\scripts" -ErrorAction SilentlyContinue
Copy-Item "$sourceDir\scripts\*.lua" -Destination "$stagingDir\scripts\"

# Compress staging directory contents to zip
Write-Host "Compressing extension files..."
Compress-Archive -Path "$stagingDir\*" -DestinationPath $outputZip -Force

# Copy to build/out/FG-CoreRPG-Coins-Weight.ext
Copy-Item $outputZip $localExt -Force

# Install to FGU extensions directory
if (Test-Path $fguExtensionsDir) {
    Write-Host "Installing FG-CoreRPG-Coins-Weight.ext to FGU ($fguExtensionsDir)..."
    Copy-Item $localExt (Join-Path $fguExtensionsDir "FG-CoreRPG-Coins-Weight.ext") -Force
}

# Install to FGC extensions directory
if (Test-Path $fgcExtensionsDir) {
    Write-Host "Installing FG-CoreRPG-Coins-Weight.ext to FGC ($fgcExtensionsDir)..."
    Copy-Item $localExt (Join-Path $fgcExtensionsDir "FG-CoreRPG-Coins-Weight.ext") -Force
}

# Clean up staging and temporary zip
Remove-Item -Recurse -Force $stagingDir
if (Test-Path $outputZip) { Remove-Item -Force $outputZip }

Write-Host "Build and Install completed successfully!"
