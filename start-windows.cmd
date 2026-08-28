@echo off
setlocal EnableExtensions
chcp 65001 >nul

title 达人报价测算器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [达人报价测算器] 未找到 Node.js，请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)

node scripts\windows\launcher.cjs %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
