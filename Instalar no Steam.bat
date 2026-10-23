@echo off
chcp 65001 >nul
python "%~dp0tvbrowser.py" --steam
echo.
pause
