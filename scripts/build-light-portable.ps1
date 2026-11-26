$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$hostDir = Join-Path $root "portable-host"
$wvDir = Join-Path $hostDir "webview2"
$releaseDir = Join-Path $root "release"

New-Item -ItemType Directory -Force -Path $wvDir | Out-Null
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$coreDll = Join-Path $wvDir "Microsoft.Web.WebView2.Core.dll"
$winFormsDll = Join-Path $wvDir "Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $wvDir "WebView2Loader.dll"

if (!(Test-Path $coreDll) -or !(Test-Path $winFormsDll) -or !(Test-Path $loaderDll)) {
    Write-Host "Scaricamento librerie WebView2 leggere da NuGet..."
    $nupkgZip = Join-Path $wvDir "webview2.zip"
    $extractTmp = Join-Path $wvDir "extracted"
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40" -OutFile $nupkgZip
    if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }
    Expand-Archive -Path $nupkgZip -DestinationPath $extractTmp -Force
    Copy-Item (Join-Path $extractTmp "lib\net462\Microsoft.Web.WebView2.Core.dll") $coreDll -Force
    Copy-Item (Join-Path $extractTmp "lib\net462\Microsoft.Web.WebView2.WinForms.dll") $winFormsDll -Force
    Copy-Item (Join-Path $extractTmp "runtimes\win-x64\native\WebView2Loader.dll") $loaderDll -Force
    Remove-Item $extractTmp -Recurse -Force
    Remove-Item $nupkgZip -Force
}

Write-Host "Compressione della cartella dist/ in dist.zip..."
$distDir = Join-Path $root "dist"
$distZip = Join-Path $hostDir "dist.zip"
if (Test-Path $distZip) { Remove-Item $distZip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($distDir, $distZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outExe = Join-Path $releaseDir "OpenRevu-Portable-Light.exe"
$iconPath = Join-Path $root "public\icon.ico"
$csPath = Join-Path $hostDir "Program.cs"

Get-Process -Name "OpenRevu-Portable-Light" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

Write-Host "Compilazione eseguibile nativo ultraleggero OpenRevu-Portable-Light.exe..."
& $csc `
    /nologo `
    /target:winexe `
    /platform:x64 `
    /optimize+ `
    "/out:$outExe" `
    "/win32icon:$iconPath" `
    /r:System.dll `
    /r:System.Drawing.dll `
    /r:System.Windows.Forms.dll `
    /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll `
    "/r:$coreDll" `
    "/r:$winFormsDll" `
    "/resource:$distZip,dist.zip" `
    "/resource:$coreDll,Microsoft.Web.WebView2.Core.dll" `
    "/resource:$winFormsDll,Microsoft.Web.WebView2.WinForms.dll" `
    "/resource:$loaderDll,WebView2Loader.dll" `
    "$csPath"

if ($LASTEXITCODE -ne 0) {
    throw "Errore durante la compilazione con csc.exe"
}

$sizeMB = [math]::Round((Get-Item $outExe).Length / 1MB, 2)
Write-Host "Completato! File generato: $outExe ($sizeMB MB)"
