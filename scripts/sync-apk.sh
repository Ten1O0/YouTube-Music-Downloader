#!/usr/bin/env bash
# ============================================================
#  Compilación de la APK  (macOS / Linux)
#  Equivalente de sync-apk.bat, que solo funciona en Windows.
#
#  Uso:
#    scripts/sync-apk.sh              compila en modo debug (por defecto)
#    scripts/sync-apk.sh --release    compila en modo release (R8, sin depuración),
#                                     firmada con la misma clave que la debug
#                                     para instalarse encima conservando los datos
#    scripts/sync-apk.sh --no-build   salta el build de Vite y reutiliza dist/
#
#  Requisitos (ver "Compilar la APK" en mobile/README.md):
#    node 20+, JDK 17, ANDROID_HOME con platform-tools y build-tools
# ============================================================
set -euo pipefail
# Todo lo de abajo usa rutas desde la raíz del proyecto
cd "$(dirname "$0")/.."

MODO="debug"
DO_BUILD=1

for arg in "$@"; do
    case "$arg" in
        --release)  MODO="release" ;;
        --debug)    MODO="debug" ;;
        --no-build) DO_BUILD=0 ;;
        *) echo "Opción desconocida: $arg"; exit 1 ;;
    esac
done

echo "============================================================"
echo "  Compilando APK ($MODO)"
echo "============================================================"
echo

# ---------- 0. Comprobaciones ----------
echo "[0/5] Comprobando el entorno..."

fallo() { echo "  ERROR: $1"; echo "         $2"; exit 1; }

command -v node >/dev/null || fallo "no se encuentra 'node'." \
    "brew install node@20"
command -v npm >/dev/null || fallo "no se encuentra 'npm'." \
    "viene con node"

if ! command -v java >/dev/null || ! java -version 2>&1 | grep -q 'version'; then
    fallo "no hay un JDK utilizable." \
          "brew install --cask temurin@17  &&  export JAVA_HOME=\"\$(/usr/libexec/java_home -v 17)\""
fi

# Capacitor 5 usa un Gradle que no soporta JDK 21+. El error que da es de
# compatibilidad de Gradle y no menciona la versión de Java, así que se
# comprueba aquí para ahorrar el rato de diagnóstico.
JAVA_MAJOR="$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')"
if [ "${JAVA_MAJOR:-0}" -ge 21 ]; then
    echo "  AVISO: Java $JAVA_MAJOR detectado. Capacitor 5 necesita JDK 17."
    echo "         export JAVA_HOME=\"\$(/usr/libexec/java_home -v 17)\""
fi

: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || fallo "ANDROID_HOME no existe ($ANDROID_HOME)." \
    "brew install --cask android-commandlinetools  &&  sdkmanager \"platform-tools\" \"platforms;android-33\" \"build-tools;33.0.2\""
export ANDROID_HOME

echo "  node    $(node --version)"
echo "  java    $(java -version 2>&1 | head -1 | sed -E 's/.*"(.*)".*/\1/')"
echo "  sdk     $ANDROID_HOME"
echo

# ---------- 1. Build de Vite ----------
if [ "$DO_BUILD" = "0" ]; then
    echo "[1/5] Build omitido (--no-build)."
    [ -f dist/index.html ] || fallo "no existe dist/index.html y se pidió --no-build." \
        "ejecuta sin --no-build"
else
    echo "[1/5] Compilando frontend con Vite..."
    [ -d node_modules ] || { echo "  node_modules ausente, instalando..."; npm install; }
    npm run build
    [ -f dist/index.html ] || fallo "el build no generó dist/index.html." "revisa la salida de Vite"
    echo "  OK"
fi
echo

# ---------- 2. Copiar dist/ a mobile/www/ ----------
echo "[2/5] Copiando dist/ a mobile/www/..."
rm -rf mobile/www
mkdir -p mobile/www
cp -R dist/. mobile/www/
echo "  OK: $(find mobile/www -type f | wc -l | tr -d ' ') ficheros"
echo

# ---------- 3. Capacitor sync ----------
echo "[3/5] Sincronizando Capacitor..."
[ -d mobile/node_modules ] || { echo "  dependencias de mobile ausentes, instalando..."; (cd mobile && npm install); }

# local.properties es lo que Gradle usa para localizar el SDK. Está en
# .gitignore (correctamente), así que en un clon nuevo hay que generarlo.
if [ ! -f mobile/android/local.properties ]; then
    echo "  generando mobile/android/local.properties..."
    echo "sdk.dir=$ANDROID_HOME" > mobile/android/local.properties
fi

(cd mobile && npx cap sync android)
echo "  OK"
echo

# ---------- 4. Gradle ----------
echo "[4/5] Compilando con Gradle ($MODO)..."
chmod +x mobile/android/gradlew

TAREA="assembleDebug"
RUTA_APK="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
if [ "$MODO" = "release" ]; then
    TAREA="assembleRelease"
    RUTA_APK="mobile/android/app/build/outputs/apk/release/app-release.apk"
fi

if ! (cd mobile/android && ./gradlew "$TAREA"); then
    echo
    echo "  Si el fallo es de verificación de dependencias, NO borres"
    echo "  mobile/android/gradle/verification-metadata.xml: regenéralo con"
    echo "    (cd mobile/android && ./gradlew --write-verification-metadata sha256 help)"
    exit 1
fi
echo "  OK"
echo

# ---------- 5. Copiar la APK a releases/ ----------
echo "[5/5] Copiando la APK a releases/..."
[ -f "$RUTA_APK" ] || fallo "Gradle no generó $RUTA_APK." "revisa la salida de arriba"

# Con otra firma, Android rechaza instalarla encima de la que ya hay y solo
# queda desinstalar, que borra la biblioteca: mejor no publicarla (plan 19, T14)
if [ "$MODO" = "release" ]; then
    FIRMA_ESPERADA="b76c5f3d4ed7f525075cddbd6721d73e6b93bb9d630523bb43cf009e400487d1"
    APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
    [ -n "$APKSIGNER" ] || fallo "no se encuentra apksigner para comprobar la firma." \
        "sdkmanager \"build-tools;33.0.2\""
    FIRMA="$("$APKSIGNER" verify --print-certs "$RUTA_APK" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)"
    [ "$FIRMA" = "$FIRMA_ESPERADA" ] || fallo "la APK no está firmada con la clave de siempre ($FIRMA)." \
        "revisa signingConfigs en mobile/android/app/build.gradle"
    echo "  Firma: la de siempre"
fi
mkdir -p releases
cp "$RUTA_APK" releases/ytmusic.apk

echo
echo "============================================================"
echo "  APK LISTA: $(pwd)/releases/ytmusic.apk"
echo "  $(du -h releases/ytmusic.apk | cut -f1)  ($MODO)"
echo "============================================================"
echo
echo "  Instalar en un dispositivo o emulador conectado:"
echo "    adb install -r releases/ytmusic.apk"
