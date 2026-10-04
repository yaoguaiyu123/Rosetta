@echo off
setlocal
cd /d "%~dp0"

rem Make node's UTF-8 output readable in this console window.
chcp 65001 >nul 2>nul

where node >nul 2>nul
if errorlevel 1 goto :no_node

if exist "dist\index.html" goto :run

echo [build] dist\index.html not found, building first ...
call npm run build
if errorlevel 1 goto :build_failed

:run
echo.
echo   PDF Translate Reader
echo   Close this window to stop the server.
echo.
node server.mjs dist --open
goto :end

:no_node
echo [ERROR] Node.js was not found in PATH.
echo         Install Node.js 20 or newer, then run this again.
pause
exit /b 1

:build_failed
echo [ERROR] Build failed. Read the messages above.
pause
exit /b 1

:end
pause
