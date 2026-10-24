# Install dsh-rewind-resend into a local DSH desktop profile.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#
# Three idempotent steps:
#   1. junction <profile>\node_modules\dsh-rewind-resend -> this folder
#   2. add "dsh-rewind-resend": "file:<this folder>" to dependencies
#   3. append "dsh-rewind-resend" to dsh.profile.bundles
# package.json is backed up to package.json.bak-<timestamp> before writing.
#
# NOTE: this file is intentionally ASCII-only so Windows PowerShell 5.1 can
# parse it regardless of the console code page.

[CmdletBinding()]
param(
	[string]$Profile = 'desktop',
	[switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-rewind-resend'
$source = (Resolve-Path $PSScriptRoot).Path
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$packageJson = Join-Path $profileDir 'package.json'

if (-not (Test-Path $packageJson)) {
	throw "profile not found: $packageJson. Start the DSH desktop app once so it creates the profile."
}

$doc = Get-Content $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$modules = Join-Path $profileDir 'node_modules'
$link = Join-Path $modules $name

if ($Uninstall) {
	if (Test-Path $link) {
		(Get-Item $link).Delete()
		Write-Host "[removed] $link"
	}
	$doc.dependencies.PSObject.Properties.Remove($name)
	$bundles = @($doc.dsh.profile.bundles | Where-Object { $_ -ne $name })
	$doc.dsh.profile.bundles = $bundles
} else {
	if (-not (Test-Path (Join-Path $source 'package.json'))) {
		throw "package.json not found in $source. Run this script from the cloned repo."
	}
	New-Item -ItemType Directory -Force -Path $modules | Out-Null
	if (Test-Path $link) { (Get-Item $link).Delete() }
	New-Item -ItemType Junction -Path $link -Target $source | Out-Null
	Write-Host "[linked] $link -> $source"

	$uri = 'file:' + ($source -replace '\\', '/')
	$doc.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $uri -Force
	$bundles = @($doc.dsh.profile.bundles)
	if ($bundles -notcontains $name) { $bundles += $name }
	$doc.dsh.profile.bundles = $bundles
}

$backup = "$packageJson.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $packageJson $backup
$doc | ConvertTo-Json -Depth 20 | Set-Content $packageJson -Encoding UTF8
Write-Host "[written] $packageJson (backup: $backup)"
if ($Uninstall) {
	Write-Host 'Restart the DSH desktop app to unload the plugin.'
} else {
	Write-Host 'Restart the DSH desktop app to load the plugin.'
	Write-Host 'Look for the pill under the composer: (rewind) gai shang yi tiao bing chong fa'
}
