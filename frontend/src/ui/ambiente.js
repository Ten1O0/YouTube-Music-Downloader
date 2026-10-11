/**
 * Fondo con los colores de la carátula que suena (plan 25, petición del usuario).
 *
 * Los colores los pone el reproductor (player/ui.js, los mismos de la pantalla
 * completa) como --art-c1 y --art-c2 en #fondoAmbiente; aquí solo se mueve. Al
 * pausar, la animación frena hasta pararse en 1,5 s; al volver a sonar, arranca
 * otra vez hasta su velocidad. Con «Reducir movimiento», quieto. Se apaga desde
 * Ajustes («Fondo con la carátula»). Se carga con la primera canción.
 */

import './ambiente.css';

const RAMPA_MS = 1500;
let iniciado = false;
let velocidad = 0;
let pedido = 0;

const suave = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

function ponerVelocidad(el, v) {
    velocidad = v;
    for (const a of el.getAnimations?.({ subtree: true }) ?? []) a.playbackRate = v;
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
}
