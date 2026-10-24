/**
 * La pantalla completa del reproductor: abrirla y cerrarla con la carátula en
 * vuelo desde el mini reproductor (plan 09, T7), arrastrarla hacia abajo para
 * cerrarla (T8) y el fundido con «Reducir movimiento».
 */

import { rubberBand, shouldDismiss, trackVerticalDrag, velocityFrom } from '../../ui/motion/gesture.js';
import { prefersReducedMotion, Spring } from '../../ui/motion/spring.js';
import { modales, NavigationModule } from '../../ui/navigation.js';
import { ajustesReproduccion, alCambiarAjustes } from './settings.js';
import { pintarFondoFp, syncFullPlayerFavoriteButton } from './ui.js';
import { crearVisualizador } from './visualizer.js';

/**
 * `cancionActual` devuelve la canción que suena: al abrir se pintan su fondo y
 * su favorito.
 */
export function createFullPlayer({ cancionActual, engine }) {
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
            const fondo = currentSong.portada ? currentSong._caratulaPintada : currentSong.thumbnail;
            if (fullPlayerBg && fondo) pintarFondoFp(fondo);
        }

        // Mientras se carga el vuelo, vale lo último que se pidió
        if (pendiente !== null) { pendiente = true; return; }
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
        // El visualizador, cuando la carátula ha llegado (T3 del plan 28): no a la vez que el vuelo
        if (!vueloFp && pendiente === null) visual.revisar();
    }

    function hideFullPlayer() {
        if (!fullPlayer) return;
        // Cerrado a mano (botón, Escape, pestaña): su entrada del historial
        // sobra. Si lo cierra el «atrás», esa entrada ya no está y no hace nada.
        NavigationModule.olvidarOverlay('fullPlayer');
        visual.revisar(false);
        if (pendiente !== null) { pendiente = false; return; }
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

    function miniVisible() {
        if (!playerThumb || !playerBar || playerBar.classList.contains('hidden')) return false;
        const r = playerThumb.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    /** Oculta el reproductor sin que su deslizamiento de respaldo se dispare. */
    function ocultarFpEnSeco() {
        fullPlayer.style.transition = 'none';
        fullPlayer.classList.add('fp-hidden');
        delete fullPlayer.dataset.presence;
        void fullPlayer.offsetWidth;
        fullPlayer.style.transition = '';
    }

    // El vuelo se carga aparte (plan 28): el código de arranque no tiene sitio.
    // Se empieza a pedir al tocar el mini reproductor, antes de soltar el dedo
    let modVuelo = null;
    let cargandoVuelo = null;
    let pendiente = null; // abrir (true) o cerrar (false) mientras se carga
    const cargarVuelo = () => (cargandoVuelo ??= import('./movimiento-fp.js').then((m) => { modVuelo = m; }));

    function volarFp(abrir) {
        if (!modVuelo) {
            pendiente = abrir;
            const seguir = () => {
                // Mientras cargaba pudo cambiar de idea: vale lo último que se pidió
                const quiere = pendiente;
                pendiente = null;
                if (quiere !== fullPlayer.classList.contains('fp-hidden')) return;
                if (modVuelo) volarFp(quiere);
                else if (quiere) fullPlayer.classList.remove('fp-hidden');
                else ocultarFpEnSeco();
                if (quiere && !vueloFp) visual.revisar();
            };
            cargarVuelo().then(seguir, seguir);
            return;
        }
        // En su sitio y sin el deslizamiento, para medir dónde acaba la carátula
        fullPlayer.dataset.presence = 'flying';
        fullPlayer.classList.remove('fp-hidden');
        const { vuelo, limpiar } = modVuelo.volarReproductor({ fullPlayer, playerBar, playerThumb, fullPlayerThumb, abrir });
        vueloFp = vuelo;

        vuelo.done.then(final => {
            if (vueloFp !== vuelo) return;
            vueloFp = null;
            if (final === 0) ocultarFpEnSeco();
            else delete fullPlayer.dataset.presence;
            limpiar();
            if (final === 1) visual.revisar();
        });
    }

    // ── Arrastrar hacia abajo para cerrar (plan 09, T8) ──
    // Con el dedo, con el ratón y con dos dedos en el trackpad. Convive con el
    // scroll que lleva a la vista de letras: solo se queda con el gesto si el
    // contenido está arriba del todo y el movimiento es hacia abajo.
    const contenidoFp = fullPlayer?.querySelector('.full-player-content');
    const transformArrastre = (y) => ({ transform: `translateY(${y}px)` });
    const radioArrastre = (y) => ({ borderRadius: `${Math.min(28, Math.max(0, y) / 5)}px` });
    const muelleArrastreFp = new Spring({
        value: 0, preset: 'snappy', precision: 0.5,
        onUpdate: (y) => Object.assign(fullPlayer.style, transformArrastre(y), radioArrastre(y)),
    });
    // Al soltar, lo mueve el compositor (plan 28, T4)
    let sueltaFp = null;

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
        // Si el dedo lo agarra mientras vuelve o se cierra, se queda donde iba
        if (sueltaFp) {
            muelleArrastreFp.jump(sueltaFp.instante().valor);
            sueltaFp.quitar();
            sueltaFp = null;
        }
        fullPlayer.dataset.presence = 'dragging';
    }

    function moverArrastreFp(dy) {
        muelleArrastreFp.jump(dy >= 0 ? dy : -rubberBand(-dy, 90));
    }

    /** Del sitio donde se soltó a `hasta`: cómo quitarlo al terminar, o null si el dedo lo agarró antes. */
    async function moverArrastreA(hasta, opciones) {
        await cargarVuelo();
        const m = modVuelo.muelleFp(
            [{ el: fullPlayer, fotograma: transformArrastre }, { el: fullPlayer, fotograma: radioArrastre }],
            { desde: muelleArrastreFp.value, hasta, velocidad: opciones.velocity, preset: opciones.preset, precision: 0.5 },
        );
        if (!m) {
            await muelleArrastreFp.to(hasta, opciones);
            return () => {};
        }
        sueltaFp = m;
        if (!(await m.terminada) || sueltaFp !== m) return null;
        sueltaFp = null;
        muelleArrastreFp.jump(hasta);
        return m.quitar;
    }

    async function soltarArrastreFp({ offset, velocity, fraccion }) {
        const alto = globalThis.innerHeight || 800;
        if (offset > 0 && shouldDismiss({ offset, velocity, size: alto, fraction: fraccion })) {
            const quitar = await moverArrastreA(Math.max(alto, offset), { preset: 'smooth', velocity: Math.max(velocity, 300) });
            if (!quitar) return;
            ocultarFpEnSeco();
            limpiarArrastreFp();
            quitar();
            NavigationModule.olvidarOverlay('fullPlayer');
        } else {
            const quitar = await moverArrastreA(0, { preset: 'snappy', velocity });
            if (!quitar) return;
            limpiarArrastreFp();
            quitar();
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
        // Con un modal encima (la cola, p. ej.), Escape es de ese modal. Si ya
        // lo ha cerrado (sheets.js marca el evento), la pila puede estar vacía
        // y el reproductor se cerraba también (plan 21, T5)
        if (e.key === 'Escape' && !e.defaultPrevented && fullPlayer && !fullPlayer.classList.contains('fp-hidden') && !modales.arriba()) hideFullPlayer();
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
    const sombraDe = (v) => Math.max(0, Math.min(1, (v - ESCALA_PAUSA) / (1 - ESCALA_PAUSA)));
    const muelleCaratula = new Spring({
        value: 1, preset: 'bouncy', precision: 0.0005,
        onUpdate: (v) => {
            if (!fullPlayerThumb) return;
            fullPlayerThumb.style.setProperty('--art-scale', String(v));
            fullPlayerThumb.style.setProperty('--art-shadow', String(sombraDe(v)));
        },
    });
    // La escala y la sombra que la acompaña, en el compositor y con los mismos
    // valores de siempre (plan 28, T4)
    let respiro = null;
    async function respirar(sonando) {
        const hasta = sonando ? 1 : ESCALA_PAUSA;
        const preset = sonando ? 'bouncy' : 'smooth';
        // Con «Reducir movimiento» no cambia de tamaño; con el reproductor cerrado no se ve
        const quieta = prefersReducedMotion();
        if (quieta || !fullPlayerThumb || fullPlayer?.classList.contains('fp-hidden')) {
            respiro?.quitar();
            respiro = null;
            muelleCaratula.jump(quieta ? 1 : hasta);
            return;
        }
        let desde = muelleCaratula.value;
        let velocidad = 0;
        // Pausar y seguir rápido: sigue desde donde iba, con su velocidad
        if (respiro) ({ valor: desde, velocidad } = respiro.instante());
        respiro?.quitar();
        await cargarVuelo();
        const m = modVuelo.muelleFp([
            { el: fullPlayerThumb, fotograma: (v) => ({ transform: `scale(${v})` }) },
            { el: fullPlayerThumb, fotograma: modVuelo.sombraQueRespira(fullPlayerThumb, sombraDe) },
        ], { desde, hasta, velocidad, preset, precision: 0.0005 });
        respiro = m;
        if (!m) { muelleCaratula.to(hasta, { preset }); return; }
        if (await m.terminada && respiro === m) {
            muelleCaratula.jump(hasta);
            m.quitar();
            respiro = null;
        }
    }

    // ── Visualizador (plan 12, T7): solo con la pantalla completa a la vista ──
    const visual = (() => {
        const lienzo = document.getElementById('fullPlayerVisualizer');
        if (!lienzo || !engine) return { revisar() {} };
        const v = crearVisualizador({
            lienzo,
            colores: () => {
                const estilo = getComputedStyle(fullPlayerBg ?? fullPlayer);
                return [estilo.getPropertyValue('--art-c1'), estilo.getPropertyValue('--art-c2')];
            },
        });
        v.conectar(engine.actual());
        engine.alCambiar((el) => v.conectar(el));
        const revisar = (abierto = fullPlayer && !fullPlayer.classList.contains('fp-hidden')) => {
            const quiere = ajustesReproduccion().visualizador && !prefersReducedMotion();
            if (abierto && quiere && document.visibilityState === 'visible') v.iniciar();
            else v.parar({ ocultar: !quiere });
        };
        document.addEventListener('visibilitychange', () => revisar());
        globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => revisar());
        alCambiarAjustes(() => revisar());
        return { revisar };
    })();

    // Tocar la carátula o el título del mini reproductor abre la pantalla completa
    for (const id of ['playerInfo', 'playerThumb']) {
        const el = document.getElementById(id);
        el?.addEventListener('pointerdown', cargarVuelo, { passive: true });
        el?.addEventListener('click', () => showFullPlayer());
    }

    /** ¿Abierto, o abriéndose? Vale lo último que se pidió, aunque aún vuele o se cargue el vuelo. */
    const abierta = () => pendiente ?? (vueloFp ? vueloFp.heading > 0 : !!fullPlayer && !fullPlayer.classList.contains('fp-hidden'));

    return { showFullPlayer, hideFullPlayer, respirar, abierta };
}
