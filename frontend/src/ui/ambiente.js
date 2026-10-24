/**
 * Fondo con los colores de la carátula que suena (plan 25, petición del usuario).
 *
 * Los colores los pone el reproductor (player/ui.js, los mismos de la pantalla
 * completa) como --art-c1 y --art-c2 en #fondoAmbiente; aquí solo se mueve. Al
 * pausar, la animación frena hasta pararse en 1,5 s; al volver a sonar, arranca
 * otra vez hasta su velocidad. Con «Reducir movimiento», quieto. Se apaga desde
 * Ajustes («Fondo con la carátula»). Se carga con la primera canción.
 *
 * Cuando no se ve, no se mueve (plan 28, T6): con el reproductor completo
 * abierto y quieto (lo tapa entero), con la app en segundo plano y ya frenado
 * del todo. Sus animaciones se pausan en vez de seguir a velocidad 0, que el
 * compositor sigue contando, y siguen donde estaban: a la vista, nada cambia.
 */

import './ambiente.css';

const RAMPA_MS = 1500;
let iniciado = false;
let velocidad = 0;
let pedido = 0;
let tapado = false;

const suave = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** ¿Se puede parar del todo? Tapado por el reproductor, en segundo plano o ya frenado. */
const parado = () => tapado || document.hidden || velocidad === 0;

/** La velocidad de ahora en sus animaciones, y pausadas mientras no se ven. */
function sincronizar(el) {
    const quieto = parado();
    for (const a of el.getAnimations?.({ subtree: true }) ?? []) {
        a.playbackRate = velocidad;
        if (quieto && a.playState === 'running') a.pause();
        else if (!quieto && a.playState === 'paused') a.play();
    }
}

function ponerVelocidad(el, v) {
    velocidad = v;
    sincronizar(el);
}

/** De la velocidad actual a `destino` (0 o 1) con una curva suave. */
function rampa(el, destino) {
    cancelAnimationFrame(pedido);
    const inicio = velocidad;
    const t0 = performance.now();
    const paso = (t) => {
        const k = Math.min(1, (t - t0) / RAMPA_MS);
        ponerVelocidad(el, inicio + (destino - inicio) * suave(k));
        if (k < 1) pedido = requestAnimationFrame(paso);
    };
    pedido = requestAnimationFrame(paso);
}

/** ¿Tapa el reproductor completo todo el fondo? Abierto y sin vuelo ni arrastre (`data-presence`). */
const tapa = (fp) => !fp.classList.contains('fp-hidden') && !fp.dataset.presence;

/**
 * Sigue al reproductor completo sin tocarlo, por su clase y su `data-presence`.
 * Al abrirse, se para cuando acaba de llegar (su deslizamiento, si lo tiene);
 * al empezar a cerrarse o a arrastrarse, vuelve a moverse antes de que se vea.
 */
function vigilarReproductor(el) {
    const fp = document.getElementById('fullPlayer');
    if (!fp) return;
    let turno = 0;
    const revisar = async () => {
        const mio = ++turno;
        if (!tapa(fp)) {
            tapado = false;
            sincronizar(el);
            return;
        }
        const llegando = (fp.getAnimations?.() ?? []).filter((a) => a.effect?.getComputedTiming?.().endTime !== Infinity);
        await Promise.allSettled(llegando.map((a) => a.finished));
        if (mio !== turno || !tapa(fp)) return;
        tapado = true;
        sincronizar(el);
    };
    new MutationObserver(revisar).observe(fp, { attributes: true, attributeFilter: ['class', 'data-presence'] });
    revisar();
}

/**
 * @param {{ activo: () => boolean, alCambiar: (fn: () => void) => void }} o
 *   si el fondo está encendido en Ajustes, y cómo enterarse de que cambia
 */
export function iniciarAmbiente({ activo, alCambiar }) {
    const el = document.getElementById('fondoAmbiente');
    const audio = document.getElementById('mainAudio');
    if (iniciado || !el || !audio) return;
    iniciado = true;
    const aplicar = () => {
        el.classList.toggle('activo', activo());
        // Al volver a encenderlo, las animaciones son nuevas: con la velocidad de ahora
        ponerVelocidad(el, audio.paused ? 0 : 1);
    };
    aplicar();
    alCambiar(aplicar);
    audio.addEventListener('play', () => rampa(el, 1));
    audio.addEventListener('pause', () => rampa(el, 0));
    vigilarReproductor(el);
    document.addEventListener('visibilitychange', () => sincronizar(el));
}
