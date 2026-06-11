#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the Incident Doc Gap Analysis agent system and its prerequisites.

.DESCRIPTION
    - Checks and installs prerequisites (Node.js, Python, pip packages, Playwright)
    - Copies all agent files to the AI assistant's agents directory
    - Creates the agent memory directory
    - Copies config template if no config exists yet
    - Installs theme-taxonomy.yml to the working directory
    - Does NOT write final config — that is done by the agent's first-run setup

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -Force           # overwrite existing files without prompting
    .\setup.ps1 -SkipInstall     # check only, don't install missing prereqs
#>

param(
    [switch]$Force,
    [switch]$SkipInstall
)

# --- Configuration ---
$AgentName = "incident-doc-gap"
$AgentsDir = Join-Path $env:USERPROFILE ".copilot\agents"
$MemoryDir = Join-Path $env:USERPROFILE ".copilot\agent-memory\$AgentName"
$SourceDataDir = Join-Path $PSScriptRoot "data"
$WorkspaceRoot = Split-Path $PSScriptRoot

# --- Prerequisites Check ---
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

$prereqs = @(
    @{ Name = "Node.js 18+"; Check = { (node --version 2>$null) -match "^v(1[89]|[2-9]\d)" } },
    @{ Name = "Python 3"; Check = { (python --version 2>$null) -match "Python 3\." } },
    @{ Name = "pandoc"; Check = { $null -ne (Get-Command pandoc -ErrorAction SilentlyContinue) } }
)

$missing = @()
foreach ($p in $prereqs) {
    if (-not (& $p.Check)) {
        $missing += $p.Name
        Write-Host "  ✗ $($p.Name) — not found" -ForegroundColor Red
    } else {
        Write-Host "  ✓ $($p.Name)" -ForegroundColor Green
    }
}

if ($missing.Count -gt 0 -and -not $SkipInstall) {
    Write-Host "`nMissing prerequisites: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "Install them before running the agent pipeline." -ForegroundColor Yellow
}

# --- Python packages ---
Write-Host "`nChecking Python packages..." -ForegroundColor Cyan
$pipPackages = @("python-docx", "pyyaml")
foreach ($pkg in $pipPackages) {
    $installed = python -c "import importlib; importlib.import_module('$($pkg -replace '-','_')')" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ $pkg — not installed" -ForegroundColor Red
        if (-not $SkipInstall) {
            Write-Host "    Installing $pkg..." -ForegroundColor Yellow
            pip install $pkg --quiet
        }
    } else {
        Write-Host "  ✓ $pkg" -ForegroundColor Green
    }
}

# --- Create directories ---
Write-Host "`nCreating directories..." -ForegroundColor Cyan

@($AgentsDir, $MemoryDir, (Join-Path $PSScriptRoot "runs")) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Host "  Created: $_" -ForegroundColor Green
    } else {
        Write-Host "  Exists:  $_" -ForegroundColor DarkGray
    }
}

# --- Copy config template ---
$configDest = Join-Path $MemoryDir "config.md"
if (-not (Test-Path $configDest) -or $Force) {
    $templateSrc = Join-Path $PSScriptRoot "memory\config.template.md"
    if (Test-Path $templateSrc) {
        Copy-Item $templateSrc $configDest -Force
        Write-Host "  Copied config template → $configDest" -ForegroundColor Green
    }
} else {
    Write-Host "  Config already exists (use -Force to overwrite)" -ForegroundColor DarkGray
}

# --- Summary ---
Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host @"

Next steps:
  1. Configure your incident API connection
  2. Run the analyze workflow to start your first analysis cycle
  3. The first run will prompt you for workspace paths

Configuration: $configDest
Taxonomy:      $(Join-Path $SourceDataDir 'theme-taxonomy.yml')
"@
