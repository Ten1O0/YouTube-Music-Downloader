/**
 * Cómo se mueve la pantalla completa del reproductor (plan 28), cargado aparte
 * la primera vez que se abre: el código de arranque no tiene sitio.
 *
 * El vuelo de la carátula desde el mini reproductor, con todo lo que aparece
 * alrededor siguiendo la misma curva, y el muelle en el compositor con el que
 * se suelta el arrastre y respira la carátula, con su sombra (full-player.js).
 */

import { fly } from '../../ui/motion/flight.js';

// Con otro nombre: dos módulos no exportan el mismo (test_estructura)
export { muelleEnCompositor as muelleFp } from '../../ui/motion/curva.js';

const PARTES = '.full-player-header, .full-player-info-row, .full-player-seek-container, '
    + '.full-player-controls, .full-player-volume-container, .full-player-footer';

/** Lo que aparece alrededor de la carátula en el instante p del vuelo. */
const opacidadFp = (p) => Math.min(1, p * 1.6);
const opacidadBarra = (p) => 1 - Math.min(1, p * 2);
function pieza(p) {
    const e = Math.max(0, Math.min(1, (p - 0.35) / 0.65));
    return { opacity: e, transform: `translateY(${(1 - e) * 16}px)` };
}

const radioDe = (el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;

const NUMERO = /-?\d*\.?\d+(?:e-?\d+)?/g;

/**
 * La sombra de la carátula que respira, para el compositor: `fotograma(v)` da
 * el filtro de CSS con --art-shadow = sombra(v). Todos sus números son
 * lineales en --art-shadow, así que se mezclan los de sus dos extremos, tal
 * como los calcula el CSS (el del móvil o el del escritorio).
 */
export function sombraQueRespira(el, sombra) {
    const previa = el.style.getPropertyValue('--art-shadow');
    const extremo = (s) => { el.style.setProperty('--art-shadow', s); return getComputedStyle(el).filter; };
    const desde = extremo('0');
    const hasta = extremo('1').match(NUMERO) ?? [];
    el.style.setProperty('--art-shadow', previa);
    return (v) => {
        const s = sombra(v);
        let i = 0;
        return { filter: desde.replace(NUMERO, (n) => String(+(+n + ((hasta[i++] ?? n) - n) * s).toFixed(3))) };
    };
}

/**
 * Hace volar la carátula del mini reproductor a la grande (o al revés) y
 * aparecer lo de alrededor. Devuelve el vuelo y cómo dejarlo todo en su CSS al
 * terminar.
 */
export function volarReproductor({ fullPlayer, playerBar, playerThumb, fullPlayerThumb, abrir }) {
    // Las piezas, una vez por vuelo (antes, en cada fotograma)
    const partes = [...fullPlayer.querySelectorAll(PARTES)];
    const capas = [
        { el: fullPlayer, fotograma: (p) => ({ opacity: opacidadFp(p) }) },
        ...partes.map((el) => ({ el, fotograma: pieza })),
        ...(playerBar ? [{ el: playerBar, fotograma: (p) => ({ opacity: opacidadBarra(p) }) }] : []),
    ];
    const vuelo = fly({
        source: playerThumb,
        target: fullPlayerThumb,
        image: fullPlayerThumb.currentSrc || fullPlayerThumb.src,
        radiusFrom: radioDe(playerThumb),
        radiusTo: radioDe(fullPlayerThumb),
        from: abrir ? 0 : 1,
        to: abrir ? 1 : 0,
        capas,
        // Sin Web Animations: lo mismo, escrito en cada fotograma
        onProgress: (p) => {
            fullPlayer.style.opacity = String(opacidadFp(p));
            for (const el of partes) Object.assign(el.style, pieza(p));
            if (playerBar) playerBar.style.opacity = String(opacidadBarra(p));
        },
    });
    fullPlayerThumb.style.visibility = 'hidden';
    playerThumb.style.visibility = 'hidden';

    const limpiar = () => {
        fullPlayer.style.opacity = '';
        for (const el of partes) { el.style.opacity = ''; el.style.transform = ''; }
        if (playerBar) playerBar.style.opacity = '';
        fullPlayerThumb.style.visibility = '';
        playerThumb.style.visibility = '';
    };
    return { vuelo, limpiar };
}
