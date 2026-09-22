@echo off
cd /d "%~dp0"
powershell -NoExit -ExecutionPolicy Bypass -NoProfile -Command "Set-Location -LiteralPath '%~dp0'; Write-Host '=== Add Node.js to PATH (user) ===' -ForegroundColor Cyan; powershell -NoProfile -ExecutionPolicy Bypass -File '.\add-node-to-path.ps1'; Write-Host ''; Write-Host '--- window stays open (-NoExit). Close it when done. ---' -ForegroundColor Yellow"
