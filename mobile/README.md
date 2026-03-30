# 📱 Compilar la APK de Android

## Requisitos

Antes de empezar, instala estas herramientas **una sola vez** en tu PC:

1. **Node.js 18+** → https://nodejs.org
2. **Java JDK 17+** → https://adoptium.net
3. **Android Studio** → https://developer.android.com/studio

### Configurar Android Studio
Después de instalar Android Studio:
1. Abre Android Studio → More Actions → SDK Manager
2. Asegúrate de tener instalado **Android SDK API 33+**
3. Ve a SDK Tools → instala **Android SDK Build-Tools**

---

## Compilar la APK (primera vez)

```bash
# 1. Entra en la carpeta mobile
cd mobile

# 2. Instala dependencias de Capacitor
npm install

# 3. Añade el proyecto Android (solo la primera vez)
npx cap add android

# 4. Sincroniza los assets
npx cap sync android

# 5. Abre en Android Studio
npx cap open android
```

En Android Studio:
1. Espera a que Gradle termine de sincronizar (~2 min)
2. **Build → Generate Signed Bundle / APK → APK**
3. Crea un keystore nuevo (guárdalo para futuras actualizaciones)
4. Selecciona "release" y pulsa Finish
5. La APK estará en `android/app/release/app-release.apk`

---

## Actualizar la APK (siguientes veces)

Gracias a que la APK carga la interfaz desde `music.dannarita.es`, **NO necesitas generar una nueva APK** para la mayoría de cambios. Solo si cambias la configuración nativa de Capacitor necesitas repetir el proceso.

Para cambios solo de UI/JS/CSS: sube los cambios al VPS y la app se actualiza automáticamente.

---

## Subir la APK a GitHub Releases

```bash
# Renombra primero
cp android/app/release/app-release.apk ytmusic.apk

# Sube manualmente en GitHub → Releases → New Release
# O con GitHub CLI:
gh release create v1.0.0 ytmusic.apk --title "YT Music v1.0" --notes "Primera versión"
```

URL de descarga resultante:
`https://github.com/Ten1O0/YouTube-Music-Downloader/releases/latest/download/ytmusic.apk`

Esta URL ya está configurada en `download.html` y en `music.dannarita.es/download`.

---

## Permisos que pide la APK

| Permiso | Motivo |
|---|---|
| `INTERNET` | Conectarse al servidor y YouTube |
| `READ_EXTERNAL_STORAGE` | Leer MP3 guardados |
| `WRITE_EXTERNAL_STORAGE` | Guardar MP3 en el dispositivo |
| `FOREGROUND_SERVICE` | Reproducción de audio en background |

---

## Solución de problemas

- **Gradle sync falla**: Acepta las licencias desde `SDK Manager → SDK Tools`
- **La app no carga la web**: Verifica que el VPS esté en marcha y que `capacitor.config.ts` tenga la URL correcta
- **Audio en background no funciona**: Asegúrate de que `capacitor-music-controls-plugin` esté instalado y sincronizado
