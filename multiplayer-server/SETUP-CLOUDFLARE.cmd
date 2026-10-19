@echo off
setlocal
title Bloodline multiplayer server - one-time setup
cd /d "%~dp0"

set "PATH=C:\Program Files\nodejs;%PATH%"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Could not find Node.js ^(npm^). Install the LTS version from https://nodejs.org/
  echo   and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   First run: installing the Cloudflare tool ^(a few minutes, one time^)...
  echo.
  call npm install wrangler --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and run this file again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   ------------------------------------------------------------------
echo    A browser window is about to open.
echo    Sign in to Cloudflare, or make a free account, then click Allow.
echo    It should come back here by itself.
echo   ------------------------------------------------------------------
echo.
pause

call npx --no-install wrangler login
if errorlevel 1 (
  echo.
  echo   Sign-in did not finish. Run this file again and try once more.
  echo.
  pause
  exit /b 1
)

echo.
echo   ------------------------------------------------------------------
echo    Deploying now.
echo.
echo    If it asks about a "workers.dev subdomain", just type any name
echo    you like (your name, the game's name) and press Enter. That is
echo    the free address your game server lives at. It asks once, ever.
echo   ------------------------------------------------------------------
echo.
call npx --no-install wrangler deploy
if errorlevel 1 (
  echo.
  echo   The deploy did not go through - copy the text above and show it to me.
  echo.
  pause
  exit /b 1
)

echo.
echo   ==================================================================
echo    DONE. Copy the https://...workers.dev address printed above and
echo    paste it back into the chat. That is the whole job.
echo   ==================================================================
echo.
pause
