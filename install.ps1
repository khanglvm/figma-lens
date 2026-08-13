param(
  [string]$Version = "latest",
  [string]$Prefix = ""
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "figma-lens requires Node.js 20+." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "figma-lens requires npm." }
$major = [int]((node --version).TrimStart("v").Split(".")[0])
if ($major -lt 20) { throw "figma-lens requires Node.js 20+." }

$args = @("install", "--global")
if ($Prefix) { $args += @("--prefix", $Prefix) }
$args += "figma-lens@$Version"
& npm @args
if ($LASTEXITCODE -ne 0) { throw "npm installation failed." }

& figma-lens --version
Write-Host "Run 'figma-lens auth login' to connect a Figma personal access token."

