@echo off
REM ===========================================================================
REM  Personal Assistant - instalador para Windows (x64 / ARM64)
REM  Haz doble clic en este archivo. No necesitas abrir PowerShell.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo   Personal Assistant - instalacion
echo   ---------------------------------
echo.

REM PowerShell viene con Windows. Ejecutamos el instalador saltandonos la
REM politica de ejecucion solo para este proceso.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1" %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo   Instalacion completada. Puedes cerrar esta ventana.
) else (
  echo   La instalacion no termino correctamente ^(codigo %RC%^).
  echo   Revisa el log:  %LOCALAPPDATA%\Personal Assistant\logs\install.log
)
echo.
pause
endlocal
exit /b %RC%
