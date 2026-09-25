/**
 * Barra de estado de Android (plan 09, T20).
 *
 * Oscura con el texto claro, del color del fondo de la app, y con el
 * reproductor abierto, del color base de su carátula (el tercero de la paleta
 * de T11): así la barra no corta el fondo en dos. Solo en la APK; la barra de
 * navegación se pinta desde el tema de Android, porque Capacitor 5 no tiene
 * API para ella.
 */

export const COLOR_BASE = '#0A0C0A';

function plugin() {
    const capacitor = globalThis.Capacitor;
    if (!capacitor?.isNative) return null;
    return capacitor.Plugins?.StatusBar ?? null;
}

/** El color que toca: el de la carátula con el reproductor abierto; si no, el de la app. */
export function colorBarra(reproductorAbierto, paleta) {
    const color = reproductorAbierto ? paleta?.[2] : null;
    return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : COLOR_BASE;
}

export function initBarraEstado({ reproductor, paleta }) {
    const barra = plugin();
    if (!barra) return { refrescar() {} };

    const callar = p => p?.catch?.(() => { /* sin barra de estado: nada que hacer */ });
    try { callar(barra.setStyle({ style: 'DARK' })); } catch { /* APK sin el complemento */ }

    let actual = null;
    function refrescar() {
        const abierto = !!reproductor && !reproductor.classList.contains('fp-hidden');
        const color = colorBarra(abierto, paleta());
        if (color === actual) return;
        actual = color;
        try { callar(barra.setBackgroundColor({ color })); } catch { /* APK sin el complemento */ }
    }

    // Todos los caminos que abren o cierran el reproductor (botón, vuelo,
    // arrastre, atrás) acaban cambiando esta clase
    if (reproductor && globalThis.MutationObserver) {
        new MutationObserver(refrescar).observe(reproductor, { attributes: true, attributeFilter: ['class'] });
    }
    refrescar();
    return { refrescar };
}
