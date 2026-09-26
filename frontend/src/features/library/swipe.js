/**
 * Deslizar una fila de la biblioteca para añadirla a la cola.
 */

import { PlayerModule } from '../player/player.js';
import { avisarHaptico } from '../../ui/haptics.js';
import { shouldCommitSwipe, swipeOffset, velocityFrom } from '../../ui/motion/gesture.js';
import { Spring } from '../../ui/motion/spring.js';

function handleSongSwipeAddToQueue(songData) {
    if (PlayerModule && typeof PlayerModule.addToNextQueue === 'function' && songData.src) {
        PlayerModule.addToNextQueue(songData);
        avisarHaptico('light');
    } else {
        console.error("PlayerModule.addToNextQueue not found or missing song src", { pm: !!PlayerModule, src: songData?.src });
    }
}

// Deslizar una fila para añadirla a la cola (plan 09, T15). Con pointer
// events, para que valga también con ratón; el scroll vertical sigue siendo
// del navegador gracias a `touch-action: pan-y` en la fila.
const UMBRAL_SWIPE = 120;

const ICONO_SWIPE_REPOSO = 0.55;

let swipeEventsInitialized = false;

export function initSwipeEvents() {
    if (swipeEventsInitialized) return;
    swipeEventsInitialized = true;

    const muelles = new WeakMap(); // fila → { fila: Spring, icono: Spring }
    let gesto = null;

    function muellesDe(fila) {
        let m = muelles.get(fila);
        if (!m) {
            const contenido = fila.querySelector('.library-item-content');
            const fondo = fila.querySelector('.swipe-action-bg');
            const indicador = fila.querySelector('.swipe-indicator');
            m = {
                fila: new Spring({
                    preset: 'snappy', precision: 0.3, onUpdate: (x) => {
                        contenido.style.transform = x > 0.3 ? `translateX(${x}px)` : '';
                        if (fondo) fondo.style.opacity = String(Math.min(1, x / UMBRAL_SWIPE));
                    }
                }),
                icono: new Spring({
                    value: ICONO_SWIPE_REPOSO, preset: 'bouncy', precision: 0.002,
                    onUpdate: (e) => { if (indicador) indicador.style.scale = String(e); }
                }),
            };
            muelles.set(fila, m);
        }
        return m;
    }

    // El clic que sigue a un arrastre no debe reproducir la canción
    function tragarseElClic() {
        const parar = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        globalThis.addEventListener('click', parar, { capture: true, once: true });
        setTimeout(() => globalThis.removeEventListener('click', parar, { capture: true }), 0);
    }

    document.addEventListener('pointerdown', (e) => {
        if (gesto || !e.isPrimary || e.button !== 0) return;
        const fila = e.target.closest('.library-item');
        if (!fila || fila.classList.contains('edit-mode') || !fila.querySelector('.library-item-content')) return;
        // Cerca de los bordes el gesto es del sistema (atrás en Android)
        if (e.pointerType !== 'mouse' && (e.clientX < 30 || e.clientX > globalThis.innerWidth - 30)) return;
        gesto = {
            fila, id: e.pointerId, fase: 'decidiendo',
            x0: e.clientX, y0: e.clientY,
            // Si la fila aún volvía de otro deslizamiento, se coge donde está
            base: muellesDe(fila).fila.value,
            distancia: 0, armado: false, muestras: [],
        };
    });

    document.addEventListener('pointermove', (e) => {
        if (e.pointerId !== gesto?.id) return;
        const dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
        const m = muellesDe(gesto.fila);
        if (gesto.fase === 'decidiendo') {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            // En vertical o hacia la izquierda, el gesto no es nuestro
            if (Math.abs(dx) <= Math.abs(dy) || dx < 0) { gesto = null; return; }
            gesto.fase = 'nuestro';
            m.fila.stop();
            try { gesto.fila.setPointerCapture(e.pointerId); } catch { /* ya soltado */ }
            document.documentElement.classList.add('deslizando-fila');
            globalThis.getSelection?.()?.removeAllRanges();
        }
        gesto.distancia = gesto.base + dx;
        gesto.muestras.push({ value: e.clientX, time: e.timeStamp });
        if (gesto.muestras.length > 8) gesto.muestras.shift();
        m.fila.jump(swipeOffset(gesto.distancia, { threshold: UMBRAL_SWIPE }));

        const armado = gesto.distancia >= UMBRAL_SWIPE;
        if (armado !== gesto.armado) {
            gesto.armado = armado;
            if (armado) {
                // Al cruzar el umbral, el icono salta con el muelle vivo
                m.icono.jump(ICONO_SWIPE_REPOSO);
                m.icono.to(1, { preset: 'bouncy' });
                avisarHaptico('selection');
            } else {
                m.icono.to(ICONO_SWIPE_REPOSO, { preset: 'snappy' });
            }
        }
    });

    function soltar(e) {
        if (e.pointerId !== gesto?.id) return;
        const g = gesto;
        gesto = null;
        if (g.fase !== 'nuestro') return;
        document.documentElement.classList.remove('deslizando-fila');
        tragarseElClic();

        const m = muellesDe(g.fila);
        const velocidad = velocityFrom(g.muestras);
        if (e.type === 'pointerup' && shouldCommitSwipe({ distance: g.distancia, velocity: velocidad, threshold: UMBRAL_SWIPE })) {
            const rawData = g.fila.dataset.song || '';
            try {
                handleSongSwipeAddToQueue(rawData ? JSON.parse(decodeURIComponent(rawData)) : {});
            } catch (err) {
                console.error('Error parsing swipe data:', err, rawData);
            }
        }
        // Vuelve con el muelle ágil; solo conserva el impulso si ya iba de vuelta
        m.fila.to(0, { preset: 'snappy', velocity: Math.min(0, velocidad) });
        m.icono.to(ICONO_SWIPE_REPOSO, { preset: 'snappy' });
    }
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', soltar);
}
