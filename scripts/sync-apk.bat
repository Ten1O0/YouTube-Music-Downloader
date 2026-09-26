@echo off
echo ========================================
echo   Syncing web assets to APK
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

echo [Bonus] Copying final APK to root folder...
copy /Y "%~dp0..\mobile\android\app\build\outputs\apk\debug\app-debug.apk" "%~dp0..\releases\ytmusic.apk" >nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Failed to copy final APK to root folder!
    pause
    exit /b %ERRORLEVEL%
)

echo ========================================
echo   Compilation complete!
echo   Your new PWA APK is ready at:
echo   %~dp0..\releases\ytmusic.apk
echo ========================================
pause
