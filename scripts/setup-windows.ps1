# Steading -- Windows setup.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

Write-Host ""
Write-Host "  Steading -- setup Windows"
Write-Host ""

function Test-Cmd($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

if (Test-Cmd 'yt-dlp') {
  Write-Host "  [ok] yt-dlp already installed"
} else {
  Write-Host "  [..] memasang yt-dlp lewat winget"
  winget install --id yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements
}

if (Test-Cmd 'ffmpeg') {
  Write-Host "  [ok] ffmpeg already installed"
} else {
  Write-Host "  [..] memasang ffmpeg lewat winget"
  winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
}

Write-Host ""
Write-Host "  Close and reopen the terminal so PATH refreshes, then run:"
Write-Host "    npm run check"
Write-Host "    npm start"
Write-Host ""
