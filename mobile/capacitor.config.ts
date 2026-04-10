import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.dannarita.music',
  appName: 'YT Music',
  webDir: 'www',
  // OFFLINE-FIRST: La app carga desde archivos locales incluidos en el APK.
  // Las llamadas API al servidor se hacen vía getApiBase() → 'https://music.dannarita.es'
  // Para actualizar la UI, hay que re-copiar los archivos a www/ y rebuild el APK.
  server: {
    // Sin 'url' → carga desde assets locales (offline-first)
    androidScheme: 'https',
    // Permitir que la WebView haga peticiones al servidor remoto
    allowNavigation: ['music.dannarita.es', '*.youtube.com', '*.ytimg.com', '*.googleapis.com', '*.google.com', '*.gstatic.com', 'accounts.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'flagcdn.com', 'buymeacoffee.com']
  },
  android: {
    // User Agent para compatibilidad con Google Auth
    overrideUserAgent: "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    allowMixedContent: true, // Allow http resources from local + https
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    Filesystem: {}
  }
};

export default config;
