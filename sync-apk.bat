@echo off
echo ========================================
echo   Syncing web assets to APK
echo ========================================
echo.

echo [1/3] Running production build with Vite...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Error: Vite build failed!
    pause
    exit /b %ERRORLEVEL%
)
echo    Build completed successfully!
echo.

echo [2/3] Copying dist assets to mobile/www...
if exist "%~dp0mobile\www" (
    rmdir /s /q "%~dp0mobile\www"
)
mkdir "%~dp0mobile\www"

xcopy /E /Y /I "%~dp0dist" "%~dp0mobile\www" >nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Failed to copy assets to mobile/www!
    pause
    exit /b %ERRORLEVEL%
)
echo    Done copying assets!
echo.

echo [3/3] Running Capacitor sync...
cd /d "%~dp0mobile"
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo Error: Capacitor sync failed!
    pause
    exit /b %ERRORLEVEL%
)
echo    Capacitor sync complete!
echo.

echo ========================================
echo   Assets synced! Now open Android Studio:
echo   cd mobile\android
echo   Open in Android Studio and Build APK
echo ========================================
pause

