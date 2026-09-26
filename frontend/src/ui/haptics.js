/**
 * Hápticos con intención (plan 09, T19).
 *
 * Solo en la APK, con @capacitor/haptics. En la web no hacen nada:
 * navigator.vibrate es tosco y en iPhone no existe. Nunca lanzan un error: un
 * háptico que falla no puede romper lo que lo provocó.
 *
 * | Momento                                                      | Háptico        |
 * |--------------------------------------------------------------|----------------|
 * | Cruzar el umbral al deslizar · coger una fila para reordenar | selección      |
 * | (cambiar de pestaña no vibra: es navegar, no confirmar nada) |                |
 * | Favorito · reproducir/pausar · soltar al reordenar · añadir  | impacto ligero |
 * | a la cola · cerrar una hoja arrastrando                      |                |
 * | Descarga terminada / fallida                                 | éxito / error  |
 */

function plugin() {
    const capacitor = globalThis.Capacitor;
    if (!capacitor?.isNative) return null;
    return capacitor.Plugins?.Haptics ?? null;
}

function llamar(accion) {
    const haptics = plugin();
    if (!haptics) return;
    try {
        accion(haptics)?.catch?.(() => { /* el sistema los tiene desactivados */ });
    } catch {
        // Un plugin a medias (APK antigua sin el complemento): sin háptico
    }
}

export const haptics = {
    selection: () => llamar(async (h) => {
        await h.selectionStart();
        await h.selectionChanged();
        await h.selectionEnd();
    }),
    impact: (style = 'LIGHT') => llamar(h => h.impact({ style })),
    success: () => llamar(h => h.notification({ type: 'SUCCESS' })),
    warning: () => llamar(h => h.notification({ type: 'WARNING' })),
    error: () => llamar(h => h.notification({ type: 'ERROR' })),
};

/** Los nombres que usa la interfaz, traducidos al háptico que toca. */
export function avisar(tipo) {
    switch (tipo) {
        case 'selection': return haptics.selection();
        case 'light': return haptics.impact('LIGHT');
        case 'medium': return haptics.impact('MEDIUM');
        case 'success': return haptics.success();
        case 'warning': return haptics.warning();
        case 'error': return haptics.error();
        default: return undefined;
    }
}

/** Atajo que usa la interfaz. */
export function avisarHaptico(tipo) { avisar(tipo); }
