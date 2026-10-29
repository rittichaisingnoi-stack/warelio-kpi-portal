@echo off
title Warelio KPI Portal & 4G/5G Mobile Tunnel
echo ====================================================
echo  Starting Warelio KPI Portal & Cloudflare Tunnel...
echo ====================================================
cd /d "%~dp0"

start "KPI Backend Server" node server.js
timeout /t 2 /nobreak >nul
start "KPI 4G/5G Mobile Tunnel" cloudflared tunnel --url http://localhost:8882

echo.
echo ====================================================
echo  Local Desktop Portal: http://localhost:8882
echo  Check the Tunnel window for your public 4G/5G URL!
echo ====================================================
pause
