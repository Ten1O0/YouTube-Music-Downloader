# 📱 Compilar la APK de Android

## Cómo funciona esta app (importante)

La APK es **offline-first**: la interfaz va empaquetada dentro del APK, no se
descarga del servidor. [`capacitor.config.ts`](capacitor.config.ts) **no define
`server.url`** a propósito.

> ⚠️ Una versión anterior de este documento decía que la APK cargaba la interfaz
> desde `music.dannarita.es` y que no hacía falta recompilar para cambios de
> UI. **Eso es falso** y contradice la configuración real. Quien lo siguiera
> subiría cambios al VPS y no vería nada en el móvil.

**Consecuencia práctica:** cualquier cambio en `frontend/` exige
**recompilar y reinstalar la APK**. Lo único que va contra el
servidor son las llamadas a la API (`apiBase()` → `https://music.dannarita.es`,
en `frontend/src/config/env.js`).

Para iterar sin recompilar en cada cambio, ver [Desarrollo con recarga en
vivo](#desarrollo-con-recarga-en-vivo) al final.

---

## Requisitos

### macOS (probado)

```bash
# 1. Node — para Vite y Capacitor
brew install node@20
node --version                     # v20.x

# 2. JDK 17 — Capacitor 5 usa un Gradle que NO soporta JDK 21+
brew install --cask temurin@17
/usr/libexec/java_home -V          # debe aparecer el 17

# 3. SDK de Android SIN Android Studio (basta con las command-line tools)
brew install --cask android-commandlinetools
export ANDROID_HOME="$HOME/Library/Android/sdk"
sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.2"
sdkmanager --licenses              # hay que aceptarlas o Gradle falla
```

Persistir en `~/.zshrc`:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

Comprobar en una terminal **nueva**:

```bash
node -v && java -version && echo $ANDROID_HOME && sdkmanager --list_installed
```

> **Sobre el JDK 17:** si usas un JDK 21 o superior, Gradle falla con un error de
> compatibilidad que **no dice qué versión de Java hace falta**. `scripts/sync-apk.sh` lo
> detecta y avisa antes de empezar.

### Windows

Node 18+, JDK 17 y Android Studio (que trae el SDK). El script equivalente es
`scripts/sync-apk.bat`.

---

## Compilar

Un solo comando, en cualquiera de las dos plataformas:

```bash
npm run sync:apk           # macOS / Linux  → scripts/sync-apk.sh
npm run sync:apk:win       # Windows        → scripts/sync-apk.bat
```

Hace cinco cosas: build de Vite → copiar `dist/` a `mobile/www/` → `cap sync
android` → `gradlew assembleDebug` → copiar el resultado a `releases/ytmusic.apk`.

Opciones:

```bash
scripts/sync-apk.sh --release     # compila en modo release en vez de debug
scripts/sync-apk.sh --no-build    # reutiliza el dist/ que ya haya
```

Instalar en un dispositivo o emulador conectado:

```bash
adb install -r releases/ytmusic.apk
```

### Si falla la verificación de dependencias

Existe `android/gradle/verification-metadata.xml` (221 KB): es un bloqueo de
firmas y hashes. Si `cap sync` trae una dependencia con un hash distinto,
**Gradle aborta a propósito**.

**No borres ese fichero.** Regenéralo:

```bash
cd mobile/android && ./gradlew --write-verification-metadata sha256 help
```

---

## Notas sobre el repositorio

- **`mobile/www/` no se versiona**: es una copia intermedia de `dist/` que
  `scripts/sync-apk.sh` regenera en cada compilación.
- **`releases/ytmusic.apk` sí se versiona**, a propósito: se quiere que un clon del
  repositorio traiga la aplicación lista para instalar.
- **`android/local.properties` no se versiona** (apunta al SDK de cada máquina).
  `scripts/sync-apk.sh` lo genera si falta.

---

## Permisos que pide la APK

| Permiso | Motivo |
|---|---|
| `INTERNET` | Conectarse al servidor y a YouTube |
| `READ_MEDIA_AUDIO` / `READ_EXTERNAL_STORAGE` | Leer los audios guardados |
| `WRITE_EXTERNAL_STORAGE` | Guardar los audios descargados |
| `POST_NOTIFICATIONS` | Notificación de reproducción |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Reproducción en segundo plano (Android 14+) |
| `WAKE_LOCK` | Que no se duerma durante la reproducción |

---

## Desarrollo con recarga en vivo

Para no recompilar en cada cambio de CSS o JS, se puede apuntar temporalmente la
WebView al servidor de desarrollo de Vite:

```ts
// capacitor.config.ts — SOLO EN DESARROLLO
server: {
  url: 'http://192.168.1.XX:5173',   // la IP de tu portátil en la red local
  cleartext: true,
  androidScheme: 'https',
  allowNavigation: [ /* ... lo que ya hay ... */ ]
}
```

Luego `npx cap sync android`, compilar **una vez**, y a partir de ahí cada cambio
se ve recargando la app.

> ⚠️ **Quita ese `url` antes de compilar la versión que vayas a distribuir**, o
> el APK seguirá apuntando a tu portátil y dejará de funcionar fuera de tu red.

Para ver la consola y la red de la app: **`chrome://inspect`** en el navegador
del ordenador, con la depuración USB activada en el dispositivo.

---

## Publicar en GitHub Releases

```bash
gh release create v1.0.0 releases/ytmusic.apk --title "YT Music v1.0" --notes "..."
```

La página de la app (`frontend/download.html`) no apunta a GitHub: descarga de
`/ytmusic.apk`, que el servidor sirve desde `releases/`.
