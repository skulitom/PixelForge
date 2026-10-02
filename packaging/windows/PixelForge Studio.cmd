@echo off
rem Starts PixelForge Studio with the Node.js runtime in this folder. Close the window to stop it.
setlocal
title PixelForge Studio
if not exist "%~dp0runtime\node.exe" goto incomplete
"%~dp0runtime\node.exe" "%~dp0launcher\studio.mjs" %*
if errorlevel 1 goto failed
exit /b 0

:incomplete
echo PixelForge Studio cannot find runtime\node.exe next to this file.
echo.
echo Extract the whole ZIP first: right-click it, choose "Extract All", then
echo double-click "PixelForge Studio.cmd" in the extracted folder.
echo.
pause
exit /b 1

:failed
echo.
echo PixelForge Studio stopped because of the error above.
pause
exit /b 1
