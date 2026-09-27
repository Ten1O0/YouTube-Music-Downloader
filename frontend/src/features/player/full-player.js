/**
 * La pantalla completa del reproductor: abrirla y cerrarla con la carátula en
 * vuelo desde el mini reproductor (plan 09, T7), arrastrarla hacia abajo para
 * cerrarla (T8) y el fundido con «Reducir movimiento».
 */

import { fly } from '../../ui/motion/flight.js';
import { rubberBand, shouldDismiss, trackVerticalDrag, velocityFrom } from '../../ui/motion/gesture.js';
import { prefersReducedMotion, Spring } from '../../ui/motion/spring.js';
import { modales, NavigationModule } from '../../ui/navigation.js';
import { pintarFondoFp, syncFullPlayerFavoriteButton } from './ui.js';

/**
 * `cancionActual` devuelve la canción que suena: al abrir se pintan su fondo y
 * su favorito.
 */
export function createFullPlayer({ cancionActual }) {
    const fullPlayer = document.getElementById('fullPlayer');
    const fullPlayerThumb = document.getElementById('fullPlayerThumb');
    const fullPlayerBg = document.getElementById('fullPlayerBg');
    const playerBar = document.getElementById('playerBar');
    const playerThumb = document.getElementById('playerThumb');

    function showFullPlayer() {
        if (!fullPlayer) return;

        // Sync favorite button before showing
        const currentSong = cancionActual();
        if (currentSong) {
            syncFullPlayerFavoriteButton(currentSong);

            // Fondo con los colores de la carátula (plan 09, T11)
            if (fullPlayerBg && currentSong.thumbnail) pintarFondoFp(currentSong.thumbnail);
        }

        // Abrir mientras se cerraba: el mismo vuelo da la vuelta
        if (vueloFp) {
            if (vueloFp.heading === 0) {
                vueloFp.retarget(1);
                NavigationModule.pushOverlayState('fullPlayer');
            }
            return;
        }
        if (!fullPlayer.classList.contains('fp-hidden')) return;

        // Se abre siempre en la vista principal, no en las letras
        const contenido = fullPlayer.querySelector('.full-player-content');
        if (contenido) contenido.scrollTop = 0;

        if (prefersReducedMotion()) {
            fundirFp(true);
        } else if (miniVisible() && fullPlayerThumb) {
            volarFp(true);
        } else {
            fullPlayer.offsetHeight.valueOf();
            fullPlayer.classList.remove('fp-hidden');
        }
        NavigationModule.pushOverlayState('fullPlayer');
    }

    function hideFullPlayer() {
        if (!fullPlayer) return;
        // Cerrado a mano (botón, Escape, pestaña): su entrada del historial
        // sobra. Si lo cierra el «atrás», esa entrada ya no está y no hace nada.
        NavigationModule.olvidarOverlay('fullPlayer');
        // Cerrar mientras se abría: el mismo vuelo da la vuelta
        if (vueloFp) {
            if (vueloFp.heading === 1) vueloFp.retarget(0);
            return;
        }
        if (fullPlayer.classList.contains('fp-hidden')) return;

        if (prefersReducedMotion()) {
            fundirFp(false);
        } else if (miniVisible() && fullPlayerThumb) {
            volarFp(false);
        } else {
            fullPlayer.classList.add('fp-hidden');
        }
    }

    // ── Transformación del mini reproductor al completo (plan 09, T7) ──
    // La carátula es el elemento compartido: vuela de la miniatura de la
    // barra a su sitio en el reproductor, y todo lo demás aparece alrededor.
    let vueloFp = null;
    const PARTES_FP = '.full-player-header, .full-player-info-row, .full-player-seek-container, '
        + '.full-player-controls, .full-player-volume-container, .full-player-footer';

    function miniVisible() {
        if (!playerThumb || !playerBar || playerBar.classList.contains('hidden')) return false;
        const r = playerThumb.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function radioDe(el) {
        return Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
    }

    /** Opacidades alrededor de la carátula en el instante p del vuelo. */
    function pintarVueloFp(p) {
        fullPlayer.style.opacity = String(Math.min(1, p * 1.6));
        const e = Math.max(0, Math.min(1, (p - 0.35) / 0.65));
        fullPlayer.querySelectorAll(PARTES_FP).forEach(el => {
            el.style.opacity = String(e);
            el.style.transform = `translateY(${(1 - e) * 16}px)`;
        });
        if (playerBar) playerBar.style.opacity = String(1 - Math.min(1, p * 2));
    }

    function limpiarVueloFp() {
        fullPlayer.style.opacity = '';
        fullPlayer.querySelectorAll(PARTES_FP).forEach(el => { el.style.opacity = ''; el.style.transform = ''; });
        if (playerBar) playerBar.style.opacity = '';
        fullPlayerThumb.style.visibility = '';
        playerThumb.style.visibility = '';
    }

    /** Oculta el reproductor sin que su deslizamiento de respaldo se dispare. */
    function ocultarFpEnSeco() {
        fullPlayer.style.transition = 'none';
        fullPlayer.classList.add('fp-hidden');
        delete fullPlayer.dataset.presence;
        void fullPlayer.offsetWidth;
        fullPlayer.style.transition = '';
    }

    function volarFp(abrir) {
        // En su sitio y sin el deslizamiento, para medir dónde acaba la carátula
        fullPlayer.dataset.presence = 'flying';
        fullPlayer.classList.remove('fp-hidden');

        const vuelo = fly({
            source: playerThumb,
            target: fullPlayerThumb,
            image: fullPlayerThumb.currentSrc || fullPlayerThumb.src,
            radiusFrom: radioDe(playerThumb),
            radiusTo: radioDe(fullPlayerThumb),
            from: abrir ? 0 : 1,
            to: abrir ? 1 : 0,
            onProgress: pintarVueloFp,
        });
        fullPlayerThumb.style.visibility = 'hidden';
        playerThumb.style.visibility = 'hidden';
        vueloFp = vuelo;

        vuelo.done.then(final => {
            if (vueloFp !== vuelo) return;
            vueloFp = null;
            if (final === 0) ocultarFpEnSeco();
            else delete fullPlayer.dataset.presence;
            limpiarVueloFp();
        });
    }

    // ── Arrastrar hacia abajo para cerrar (plan 09, T8) ──
    // Con el dedo, con el ratón y con dos dedos en el trackpad. Convive con el
    // scroll que lleva a la vista de letras: solo se queda con el gesto si el
    // contenido está arriba del todo y el movimiento es hacia abajo.
    const contenidoFp = fullPlayer?.querySelector('.full-player-content');
    const muelleArrastreFp = new Spring({
        value: 0, preset: 'snappy', precision: 0.5,
        onUpdate: (y) => {
            fullPlayer.style.transform = `translateY(${y}px)`;
            fullPlayer.style.borderRadius = `${Math.min(28, Math.max(0, y) / 5)}px`;
        },
    });

    function limpiarArrastreFp() {
        delete fullPlayer.dataset.presence;
        fullPlayer.style.transform = '';
        fullPlayer.style.borderRadius = '';
    }

    /** ¿Puede empezar aquí un arrastre? Arriba del todo y fuera de las barras. */
    function puedeArrastrarFp(objetivo) {
        return !vueloFp && !fullPlayer.classList.contains('fp-hidden')
            && (contenidoFp?.scrollTop ?? 0) <= 0
            && !objetivo?.closest?.('.full-player-seek-container, .full-player-volume-container, input');
    }

    function empezarArrastreFp() {
        muelleArrastreFp.stop();
        fullPlayer.dataset.presence = 'dragging';
    }

    function moverArrastreFp(dy) {
        muelleArrastreFp.jump(dy >= 0 ? dy : -rubberBand(-dy, 90));
    }

    async function soltarArrastreFp({ offset, velocity, fraccion }) {
        const alto = globalThis.innerHeight || 800;
        if (offset > 0 && shouldDismiss({ offset, velocity, size: alto, fraction: fraccion })) {
            await muelleArrastreFp.to(Math.max(alto, offset), { preset: 'smooth', velocity: Math.max(velocity, 300) });
            ocultarFpEnSeco();
            limpiarArrastreFp();
            NavigationModule.olvidarOverlay('fullPlayer');
        } else {
            await muelleArrastreFp.to(0, { preset: 'snappy', velocity });
            limpiarArrastreFp();
        }
    }

    if (fullPlayer) {
        // Con el dedo
        trackVerticalDrag(fullPlayer, {
            canStart: e => puedeArrastrarFp(e.target),
            onStart: empezarArrastreFp,
            onMove: moverArrastreFp,
            onEnd: soltarArrastreFp,
        });

        // Con el ratón: pulsar y arrastrar hacia abajo desde cualquier sitio.
        // Sin esto, arrastrar sobre la carátula arrancaría el arrastre nativo
        // de imágenes del navegador, que cancela el puntero
        fullPlayer.addEventListener('dragstart', e => e.preventDefault());
        let raton = null;
        fullPlayer.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0 || !puedeArrastrarFp(e.target)) return;
            raton = { id: e.pointerId, x0: e.clientX, y0: e.clientY, nuestro: false, muestras: [] };
        });
        fullPlayer.addEventListener('pointermove', (e) => {
            if (e.pointerId !== raton?.id) return;
            const dx = e.clientX - raton.x0, dy = e.clientY - raton.y0;
            if (!raton.nuestro) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                // Hacia arriba o de lado no es un cierre
                if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { raton = null; return; }
                raton.nuestro = true;
                try { fullPlayer.setPointerCapture(e.pointerId); } catch { /* ya soltado */ }
                document.documentElement.classList.add('arrastrando-reproductor');
                globalThis.getSelection?.()?.removeAllRanges();
                empezarArrastreFp();
            }
            raton.muestras.push({ value: dy, time: e.timeStamp });
            if (raton.muestras.length > 8) raton.muestras.shift();
            moverArrastreFp(dy);
        });
        const soltarRaton = (e) => {
            if (e.pointerId !== raton?.id) return;
            const r = raton;
            raton = null;
            if (!r.nuestro) return;
            document.documentElement.classList.remove('arrastrando-reproductor');
            // El clic que sigue al arrastre no debe pulsar nada
            const parar = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            globalThis.addEventListener('click', parar, { capture: true, once: true });
            setTimeout(() => globalThis.removeEventListener('click', parar, { capture: true }), 0);
            const ultima = r.muestras.at(-1)?.value ?? 0;
            soltarArrastreFp({ offset: e.type === 'pointerup' ? ultima : 0, velocity: velocityFrom(r.muestras) });
        };
        fullPlayer.addEventListener('pointerup', soltarRaton);
        fullPlayer.addEventListener('pointercancel', soltarRaton);

        // Con dos dedos en el trackpad (o la rueda): tirar hacia abajo estando
        // arriba del todo. El gesto tiene que empezar ya arriba: si se llega
        // al tope subiendo desde las letras, la inercia no lo cierra.
        let ultimaRueda = -Infinity;
        let rueda = null;
        fullPlayer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) return; // pellizco para ampliar
            const continua = e.timeStamp - ultimaRueda < 150;
            ultimaRueda = e.timeStamp;
            if (!rueda) {
                if (continua || e.deltaY >= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !puedeArrastrarFp(e.target)) return;
                rueda = { offset: 0, muestras: [], fin: 0 };
                empezarArrastreFp();
            }
            e.preventDefault();
            const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * globalThis.innerHeight : e.deltaY;
            rueda.offset -= px;
            rueda.muestras.push({ value: rueda.offset, time: e.timeStamp });
            if (rueda.muestras.length > 8) rueda.muestras.shift();
            moverArrastreFp(rueda.offset);
            // Sin eventos durante un momento, los dedos (y la inercia) han terminado
            clearTimeout(rueda.fin);
            rueda.fin = setTimeout(() => {
                const r = rueda;
                rueda = null;
                soltarArrastreFp({ offset: r.offset, velocity: velocityFrom(r.muestras), fraccion: 0.2 });
            }, 150);
        }, { passive: false });
    }

    // En escritorio, Escape cierra el reproductor
    document.addEventListener('keydown', (e) => {
        // Con un modal encima (la cola, p. ej.), Escape es de ese modal
        if (e.key === 'Escape' && fullPlayer && !fullPlayer.classList.contains('fp-hidden') && !modales.arriba()) hideFullPlayer();
    });

    /** «Reducir movimiento»: fundido de 180 ms, sin vuelo. */
    function fundirFp(abrir) {
        fullPlayer.dataset.presence = 'flying';
        fullPlayer.style.transition = 'none';
        if (abrir) {
            fullPlayer.style.opacity = '0';
            fullPlayer.classList.remove('fp-hidden');
            void fullPlayer.offsetWidth;
        }
        fullPlayer.style.transition = 'opacity 180ms linear';
        fullPlayer.style.opacity = abrir ? '1' : '0';
        esperarTransicion(fullPlayer, 'opacity', 300).then(() => {
            if (abrir) {
                fullPlayer.style.transition = '';
                fullPlayer.style.opacity = '';
                delete fullPlayer.dataset.presence;
            } else {
                ocultarFpEnSeco();
                fullPlayer.style.opacity = '';
            }
        });
    }

    /** Espera al final de una transición concreta, con tope por si no llega. */
    function esperarTransicion(el, propiedad, maxMs) {
        return new Promise(resolve => {
            const fin = (e) => {
                if (e && (e.target !== el || e.propertyName !== propiedad)) return;
                el.removeEventListener('transitionend', fin);
                clearTimeout(reloj);
                resolve();
            };
            el.addEventListener('transitionend', fin);
            const reloj = setTimeout(fin, maxMs);
        });
    }

    // ── La carátula respira: encoge al pausar y vuelve al reproducir (plan 09, T9) ──
    
    const ESCALA_PAUSA = 0.82;
    const muelleCaratula = new Spring({
        value: 1, preset: 'bouncy', precision: 0.0005,
        onUpdate: (v) => {
            if (!fullPlayerThumb) return;
            fullPlayerThumb.style.setProperty('--art-scale', String(v));
            fullPlayerThumb.style.setProperty('--art-shadow', String(Math.max(0, Math.min(1, (v - ESCALA_PAUSA) / (1 - ESCALA_PAUSA)))));
        },
    });
    function respirar(sonando) {
        // Con «Reducir movimiento» la carátula no cambia de tamaño
        if (prefersReducedMotion()) { muelleCaratula.jump(1); return; }
        muelleCaratula.to(sonando ? 1 : ESCALA_PAUSA, { preset: sonando ? 'bouncy' : 'smooth' });
    }

    return { showFullPlayer, hideFullPlayer, respirar };
}
