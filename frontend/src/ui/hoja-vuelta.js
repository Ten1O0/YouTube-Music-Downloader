/**
 * La vuelta de una hoja soltada a medio arrastrar (plan 28, T5): la misma curva
 * del muelle, pero en el compositor, que no se para aunque el hilo principal
 * esté ocupado (en la APK, sus hilos tienen poca prioridad). Sin Web
 * Animations o con «Reducir movimiento», el muelle de siempre.
 *
 * Se carga aparte la primera vez que se arrastra una hoja (sheets.js): el
 * código de arranque no tiene sitio.
 */

import { muelleEnCompositor } from './motion/curva.js';
import { prefersReducedMotion } from './motion/spring.js';

/**
 * Lleva el panel de la hoja a su sitio. `vueltas` (modal → vuelta) deja que el
 * dedo la agarre a mitad (`agarrar`) y que cerrarla la quite (`quitar`).
 * Devuelve si llegó.
 */
export async function volverHoja({ modal, panel, muelle, velocidad, vueltas }) {
    const vuelta = prefersReducedMotion() ? null : muelleEnCompositor(
        [{ el: panel, fotograma: (y) => ({ transform: `translateY(${y}px)` }) }],
        { desde: muelle.value, hasta: 0, velocidad, preset: 'snappy', precision: 0.5 },
    );
    if (!vuelta) {
        await muelle.to(0, { velocity: velocidad });
        return true;
    }
    vueltas.set(modal, {
        quitar: vuelta.quitar,
        // Desde donde iba: el muelle sigue al dedo a partir de ahí
        agarrar: () => { muelle.jump(vuelta.instante().valor); vuelta.quitar(); },
    });
    const llego = await vuelta.terminada;
    vueltas.delete(modal);
    if (llego) {
        muelle.jump(0);
        vuelta.quitar();
    }
    return llego;
}
