# 把 dsh-rewind-resend 装进本机的 DSH desktop profile。
#
#   pwsh -File install.ps1                 # 装到默认的 desktop profile
#   pwsh -File install.ps1 -Profile web    # 装到别的 profile
#   pwsh -File install.ps1 -Uninstall      # 卸掉（junction + 依赖 + bundle）
#
# 做三件事，全部幂等：
#   1. 在 <profile>\node_modules 里给本目录建一个 junction；
#   2. 把 "dsh-rewind-resend": "file:<本目录>" 写进 dependencies；
#   3. 把 "dsh-rewind-resend" 追加到 dsh.profile.bundles。
# 改 package.json 之前会先备份成 package.json.bak-<时间>。

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
	throw "找不到 profile：$packageJson。先启动一次 DSH desktop 让它初始化。"
}

$doc = Get-Content $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$modules = Join-Path $profileDir 'node_modules'
$link = Join-Path $modules $name

if ($Uninstall) {
	if (Test-Path $link) {
		(Get-Item $link).Delete()
		Write-Host "已移除 $link"
	}
	$doc.dependencies.PSObject.Properties.Remove($name)
	$bundles = @($doc.dsh.profile.bundles | Where-Object { $_ -ne $name })
	$doc.dsh.profile.bundles = $bundles
} else {
	New-Item -ItemType Directory -Force -Path $modules | Out-Null
	if (Test-Path $link) { (Get-Item $link).Delete() }
	New-Item -ItemType Junction -Path $link -Target $source | Out-Null
	Write-Host "已链接 $link -> $source"

	$uri = 'file:' + ($source -replace '\\', '/')
	$doc.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $uri -Force
	$bundles = @($doc.dsh.profile.bundles)
	if ($bundles -notcontains $name) { $bundles += $name }
	$doc.dsh.profile.bundles = $bundles
}

$backup = "$packageJson.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $packageJson $backup
$doc | ConvertTo-Json -Depth 20 | Set-Content $packageJson -Encoding UTF8
Write-Host "已写入 $packageJson（备份：$backup）"
Write-Host '重启 DSH 桌面端后生效：bundle 只在启动时进 boot graph。'
