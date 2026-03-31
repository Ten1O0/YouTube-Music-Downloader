import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.dannarita.music',
  appName: 'YT Music',
  webDir: 'www',
  // ← Dummy webDir, la UI carga del server remoto
  // Con server.url la APK carga siempre desde el VPS en vivo.
  // Cualquier actualización en el servidor se refleja automáticamente en la app.
  server: {
    url: 'https://music.dannarita.es',
    cleartext: false,
    // Permite cookies y auth en la WebView
    androidScheme: 'https'
  },
  android: {
    // Engañamos a Google Auth haciéndonos pasar por Chrome
    overrideUserAgent: "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    // Permite reproducción de audio en background
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    // HTTP nativo para peticiones que bypaseen CORS en WebView
    CapacitorHttp: {
      enabled: true
    },
    // Filesystem: acceso al almacenamiento del dispositivo
    Filesystem: {
      // Los archivos MP3 se guardan en Documents para acceso persistente
    }
  }
};

export default config;
