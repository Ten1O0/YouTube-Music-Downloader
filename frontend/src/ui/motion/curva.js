/**
 * Muelles que mueve el compositor y que pueden empezar en cualquier punto y con
 * cualquier velocidad (plan 28): lo que sale del dedo al soltarlo y lo que
 * cambia de rumbo a mitad.
 *
 * El mismo integrador que `Spring` (spring.js), con pasos de 1/600 s, da un
 * valor por fotograma de 1/60 s. Con un fotograma clave por cada uno y
 * `easing: linear`, Web Animations dibuja lo mismo que el muelle de
 * JavaScript, pero en el compositor: no se para aunque el hilo principal esté
 * ocupado (en la APK, sus hilos tienen poca prioridad). Tampoco depende de que
 * el WebView entienda `linear()`.
 *
 * Se carga aparte de spring.js: el código de arranque no tiene sitio.
 */

import { physics, scheduler, SPRINGS } from './spring.js';

const FPS = 60;
const PASOS = 10;
const H = 1 / (FPS * PASOS);

/**
 * Un muelle de `desde` a `hasta` que sale con `velocidad` (unidades por
 * segundo): un valor y una velocidad por fotograma, y lo que dura. Pura.
 */
export function curvaDesde({ desde = 0, hasta = 1, velocidad = 0, preset = 'smooth', precision = 0.001 } = {}) {
    const { stiffness: k, damping: c } = physics(typeof preset === 'string' ? SPRINGS[preset] : preset);
    let x = desde;
    let v = velocidad;
    const valores = [x];
    const velocidades = [v];
    for (let f = 1; f <= 600; f++) {
        for (let i = 0; i < PASOS; i++) {
            const a = -k * (x - hasta) - c * v;
            v += a * H;
            x += v * H;
        }
        valores.push(x);
        velocidades.push(v);
        if (Math.abs(x - hasta) < precision && Math.abs(v) < precision * 12) break;
    }
    valores[valores.length - 1] = hasta;
    velocidades[velocidades.length - 1] = 0;
    return { valores, velocidades, durationMs: ((valores.length - 1) * 1000) / FPS };
}

/** Dónde va y a qué velocidad la curva a los `ms`, entre fotograma y fotograma. Pura. */
export function enInstante(curva, ms) {
    const f = Math.max(0, (ms * FPS) / 1000);
    const i = Math.min(Math.floor(f), curva.valores.length - 1);
    if (i >= curva.valores.length - 1) return { valor: curva.valores.at(-1), velocidad: 0 };
    const t = f - i;
    return {
        valor: curva.valores[i] + (curva.valores[i + 1] - curva.valores[i]) * t,
        velocidad: curva.velocidades[i] + (curva.velocidades[i + 1] - curva.velocidades[i]) * t,
    };
}

/**
 * Anima `el` con un fotograma clave por cada valor de la curva:
 * `fotograma(valor)` da las propiedades (transform, opacity…) de ese valor.
 * Devuelve la animación, o null sin Web Animations (entonces, con `Spring`).
 */
export function animarCurva(el, curva, fotograma) {
    if (typeof el?.animate !== 'function') return null;
    const n = curva.valores.length - 1;
    const fotogramas = curva.valores.map((x, i) => ({ ...fotograma(x), offset: n ? i / n : 1 }));
    return el.animate(fotogramas, { duration: curva.durationMs * scheduler.slow, easing: 'linear', fill: 'forwards' });
}

/**
 * Un muelle de `desde` a `hasta` en el compositor sobre varias pistas
 * ({ el, fotograma }). `terminada` dice si llegó (false si se quitó antes),
 * `instante()` dónde va y a qué velocidad (para seguir desde ahí si el dedo lo
 * agarra o cambia de rumbo) y `quitar()` lo retira. null sin Web Animations.
 */
export function muelleEnCompositor(pistas, { desde, hasta, velocidad = 0, preset, precision }) {
    const curva = curvaDesde({ desde, hasta, velocidad, preset, precision });
    const animaciones = pistas.map(({ el, fotograma }) => animarCurva(el, curva, fotograma));
    if (!animaciones[0]) return null;
    return {
        terminada: animaciones[0].finished.then(() => true, () => false),
        instante: () => enInstante(curva, (animaciones[0].currentTime ?? 0) / scheduler.slow),
        quitar: () => animaciones.forEach((a) => a?.cancel()),
    };
}
