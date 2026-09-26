/**
 * Dónde se está ejecutando la app, navegador o APK, y a qué servidor llamar.
 *
 * Antes había dos respuestas distintas a la misma pregunta: IS_NATIVE/API_BASE,
 * que se recalculaban, y API_URL, una constante evaluada al cargar que no se
 * enteraba si Capacitor aparecía después y miraba otras señales (plan 08, D2).
 * Ahora es una sola detección, que une las dos, y son funciones: responden con
 * el estado de ese momento.
 */

/** El servidor al que llama la APK, que no tiene un dominio propio del que tirar. */
export const SERVIDOR = 'https://music.dannarita.es';

export const isNative = () => (
    globalThis.Capacitor?.isNative === true ||
    ['android', 'ios'].includes(globalThis.Capacitor?.platform) ||
    navigator.userAgent.includes('Capacitor') ||
    location.protocol.startsWith('capacitor') ||
    location.protocol.startsWith('file')
);

/** Prefijo de las llamadas a la API: vacío en la web (mismo origen), el servidor en la APK. */
export const apiBase = () => (isNative() ? SERVIDOR : '');
