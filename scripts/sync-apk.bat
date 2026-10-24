@echo off
echo ========================================
echo   Building a test APK (debug)
echo ========================================
echo.

echo [1/3] Running production build with Vite...
cd /d "%~dp0.."
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Error: Vite build failed!
    pause
    exit /b %ERRORLEVEL%
)
echo    Build completed successfully!
echo.

echo [2/3] Copying dist assets to mobile/www...
if exist "%~dp0..\mobile\www" (
    rmdir /s /q "%~dp0..\mobile\www"
)
mkdir "%~dp0..\mobile\www"

xcopy /E /Y /I "%~dp0..\dist" "%~dp0..\mobile\www" >nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Failed to copy assets to mobile/www!
    pause
    exit /b %ERRORLEVEL%
)
echo    Done copying assets!
echo.

echo [3/4] Running Capacitor sync...
rem Arreglos a plugins (el boton de reproducir y pausar de la notificacion)
call node "%~dp0parchear-plugins.mjs"
if %ERRORLEVEL% NEQ 0 (
    echo Error: no se pudieron aplicar los arreglos a los plugins!
    pause
    exit /b %ERRORLEVEL%
)
cd /d "%~dp0..\mobile"
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo Error: Capacitor sync failed!
    pause
    exit /b %ERRORLEVEL%
)
echo    Capacitor sync complete!
echo.

echo [4/4] Compiling Android APK using Gradle...
cd /d "%~dp0..\mobile\android"
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo Error: Gradle build failed!
    pause
    exit /b %ERRORLEVEL%
)
echo    APK compiled successfully!
echo.

echo ========================================
echo   Compilation complete!
echo   Test APK (debug signature) ready at:
echo   %~dp0..\mobile\android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo   releases\ytmusic.apk is not touched: the published APK carries the
echo   production signature and is built with scripts/sync-apk.sh
echo ========================================
pause
