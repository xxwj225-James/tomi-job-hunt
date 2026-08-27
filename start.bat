@echo off
chcp 65001 >nul
title TomiHunt Core
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [TomiHunt] 未检测到 Node.js，请先到 https://nodejs.org 下载安装（LTS 版本）。
  echo 如果只是想用插件基础功能（打招呼语/打分），不需要启动本服务，
  echo 直接在插件设置页粘贴 API Key 即可使用「直连模式」。
  pause
  exit /b 1
)

echo [TomiHunt] 正在启动本地 Core 服务（127.0.0.1:3000）...
echo [TomiHunt] 保持本窗口开启即可。关闭窗口即停止服务。
echo [TomiHunt] 首次使用会自动打开浏览器设置页（配置 LLM / 上传简历）。
echo [TomiHunt] 手动访问: http://127.0.0.1:3000/setup

if not exist node_modules (
  echo [TomiHunt] 首次运行，正在安装依赖（约1-2分钟）...
  call npm install
) else (
  rem OTA: git-based installs pull the latest code on every start
  if exist .git (
    echo [TomiHunt] 正在检查更新...
    git pull --ff-only >nul 2>nul
    if not errorlevel 1 call npm install >nul 2>nul
  )
)

call npm start -w core
pause
