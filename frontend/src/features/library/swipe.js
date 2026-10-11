/**
 * Deslizar una fila: a la derecha, «Siguiente» en la cola (biblioteca y
 * listas). A la izquierda, quitarla de la lista, con deshacer (plan 24, P10):
 * solo en las listas que se pueden editar. En la biblioteca, a la izquierda no
 * hace nada: el usuario no quiere que borrar sea tan fácil.
 */

import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists } from '../playlists/store.js';
import { LibraryModule } from './library.js';
import { html, seguro } from '../../core/html.js';
import { i18n } from '../../i18n/language-manager.js';
import { shouldCommitSwipe, swipeOffset, velocityFrom } from '../../ui/motion/gesture.js';
import { Spring } from '../../ui/motion/spring.js';

function handleSongSwipeAddToQueue(songData) {
    if (PlayerModule && typeof PlayerModule.addToNextQueue === 'function' && songData.src) {
        PlayerModule.addToNextQueue(songData);
    } else {
        console.error("PlayerModule.addToNextQueue not found or missing song src", { pm: !!PlayerModule, src: songData?.src });
    }
}

// Deslizar una fila para añadirla a la cola (plan 09, T15). Con pointer
// events, para que valga también con ratón; el scroll vertical sigue siendo
// del navegador gracias a `touch-action: pan-y` en la fila.
const UMBRAL_SWIPE = 120;

const ICONO_SWIPE_REPOSO = 0.55;

const ICONO_QUITAR = seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14"/></svg>');

/** ¿Esta fila se puede quitar deslizándola a la izquierda? Las de una lista editable. */
const sePuedeQuitar = (fila) => Boolean(fila.closest('#playlistDetailList') && fila.querySelector('.pl-remove-btn'));

/**
 * El fondo de la fila según el lado: verde con «Siguiente» a la derecha, rojo
 * con «Quitar» a la izquierda. Con estilos en línea: el CSS del arranque está
 * en el límite de su presupuesto.
 */
function ponerLado(fondo, izquierda) {
    if (!fondo || fondo.dataset.lado === (izquierda ? 'quitar' : 'cola')) return;
    fondo.dataset.lado = izquierda ? 'quitar' : 'cola';
    let quitar = fondo.querySelector('.swipe-indicator-quitar');
    if (izquierda && !quitar) {
        quitar = document.createElement('div');
        quitar.className = 'swipe-indicator swipe-indicator-quitar';
        quitar.style.transformOrigin = 'right center';
        quitar.innerHTML = html`<span>${i18n.t('t_remove')}</span>${ICONO_QUITAR}`;
        fondo.append(quitar);
    }
    fondo.style.backgroundColor = izquierda ? 'var(--accent-error)' : '';
    fondo.style.justifyContent = izquierda ? 'flex-end' : '';
    fondo.style.paddingRight = izquierda ? '20px' : '';
    for (const ind of fondo.querySelectorAll('.swipe-indicator')) {
        ind.style.display = ind.classList.contains('swipe-indicator-quitar') === izquierda ? '' : 'none';
    }
}

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
            m = {
                fila: new Spring({
                    preset: 'snappy', precision: 0.3, onUpdate: (x) => {
                        contenido.style.transform = Math.abs(x) > 0.3 ? `translateX(${x}px)` : '';
                        if (Math.abs(x) > 0.3) ponerLado(fondo, x < 0);
                        if (fondo) fondo.style.opacity = String(Math.min(1, Math.abs(x) / UMBRAL_SWIPE));
                    }
                }),
                icono: new Spring({
                    value: ICONO_SWIPE_REPOSO, preset: 'bouncy', precision: 0.002,
                    onUpdate: (e) => { for (const ind of fila.querySelectorAll('.swipe-indicator')) ind.style.scale = String(e); }
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
        // En la selección múltiple, tocar una fila la marca (plan 24, P8)
        if (document.documentElement.classList.contains('seleccionando')) return;
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
            izquierda: sePuedeQuitar(fila),
        };
    });

    document.addEventListener('pointermove', (e) => {
        if (e.pointerId !== gesto?.id) return;
        const dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
        const m = muellesDe(gesto.fila);
        if (gesto.fase === 'decidiendo') {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            // En vertical, o hacia la izquierda donde no se puede quitar, el gesto no es nuestro
            if (Math.abs(dx) <= Math.abs(dy) || (dx < 0 && !gesto.izquierda)) { gesto = null; return; }
            gesto.fase = 'nuestro';
            m.fila.stop();
            try { gesto.fila.setPointerCapture(e.pointerId); } catch { /* ya soltado */ }
            document.documentElement.classList.add('deslizando-fila');
            globalThis.getSelection?.()?.removeAllRanges();
        }
        gesto.distancia = gesto.base + dx;
        gesto.muestras.push({ value: e.clientX, time: e.timeStamp });
        if (gesto.muestras.length > 8) gesto.muestras.shift();
        const d = gesto.distancia;
        m.fila.jump(d >= 0 ? swipeOffset(d, { threshold: UMBRAL_SWIPE }) : (gesto.izquierda ? -swipeOffset(-d, { threshold: UMBRAL_SWIPE }) : 0));

        const armado = Math.abs(d) >= UMBRAL_SWIPE && (d > 0 || gesto.izquierda);
        if (armado !== gesto.armado) {
            gesto.armado = armado;
            if (armado) {
                // Al cruzar el umbral, el icono salta con el muelle vivo
                m.icono.jump(ICONO_SWIPE_REPOSO);
                m.icono.to(1, { preset: 'bouncy' });
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
            // La fila solo lleva su src (plan 19, T4): la canción, de memoria
            cancionDeFila(g.fila.dataset.src)
                .then((song) => handleSongSwipeAddToQueue(song ?? {}))
                .catch((err) => console.error('Error en el deslizamiento:', err));
        } else if (e.type === 'pointerup' && g.izquierda
            && shouldCommitSwipe({ distance: -g.distancia, velocity: -velocidad, threshold: UMBRAL_SWIPE })) {
            const src = g.fila.dataset.src;
            import('../seleccion/acciones.js')
                .then((a) => a.quitarDeListaConDeshacer(PlaylistModule.currentPlaylistId, [src]))
                .catch((err) => console.error('Error al quitar de la lista:', err));
        }
        // Vuelve con el muelle ágil; solo conserva el impulso si ya iba de vuelta
        m.fila.to(0, { preset: 'snappy', velocity: g.distancia >= 0 ? Math.min(0, velocidad) : Math.max(0, velocidad) });
        m.icono.to(ICONO_SWIPE_REPOSO, { preset: 'snappy' });
    }
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', soltar);
}

/** La canción de una fila: de la biblioteca o, si no está (una de una lista), de las listas. */
async function cancionDeFila(src) {
    if (!src) return null;
    const enBiblioteca = (await LibraryModule.getLibrary()).find((s) => s.src === src);
    if (enBiblioteca) return enBiblioteca;
    for (const pl of await getPlaylists()) {
        const enLista = pl.songs?.find((s) => s.src === src);
        if (enLista) return enLista;
    }
    return null;
}
