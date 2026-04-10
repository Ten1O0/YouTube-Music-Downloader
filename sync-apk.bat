@echo off
echo ========================================
echo   Syncing web assets to APK
echo ========================================
echo.

echo [1/3] Copying web files to mobile/www...
copy /Y "%~dp0index.html" "%~dp0mobile\www\index.html" >nul
copy /Y "%~dp0app.js" "%~dp0mobile\www\app.js" >nul
copy /Y "%~dp0styles.css" "%~dp0mobile\www\styles.css" >nul
copy /Y "%~dp0manifest.json" "%~dp0mobile\www\manifest.json" >nul
copy /Y "%~dp0favicon.png" "%~dp0mobile\www\favicon.png" >nul
copy /Y "%~dp0sw.js" "%~dp0mobile\www\sw.js" >nul
copy /Y "%~dp0download.html" "%~dp0mobile\www\download.html" >nul
echo    Done!

echo [2/3] Running Capacitor sync...
cd /d "%~dp0mobile"
call npx cap sync android
echo    Done!

echo [3/3] Ready!
echo.
echo ========================================
echo   Assets synced! Now open Android Studio:
echo   cd mobile\android
echo   Open in Android Studio and Build APK
echo ========================================
pause
