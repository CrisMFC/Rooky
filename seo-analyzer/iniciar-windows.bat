@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js 20 o superior: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias... & call npm install || (pause & exit /b 1))
start "" http://127.0.0.1:3000
node server.js
pause
