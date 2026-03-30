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
