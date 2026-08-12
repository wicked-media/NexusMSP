@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\NexusLocal.ps1" -Action Restart
if errorlevel 1 pause
