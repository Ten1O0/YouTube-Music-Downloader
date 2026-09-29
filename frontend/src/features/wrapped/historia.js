/**
 * La historia de «Tu año en música» (plan 17, T4).
 *
 * Diapositivas a pantalla completa con barras de progreso arriba, como las
 * historias de Instagram: toque a la derecha avanza, a la izquierda vuelve,
 * mantener pulsado pausa y deslizar hacia abajo cierra. Cada una dura 6 s.
 *
 * Con «Reducir movimiento» no hay cuentas atrás animadas ni entradas
 * escalonadas: los números salen puestos y las diapositivas se cambian de golpe.
 * El tiempo de cada diapositiva no cambia, que eso no es movimiento.
 */

import { html, seguro } from '../../core/html.js';
import { resolveStreamSrc } from '../../core/audio-store.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisar } from '../../ui/toast.js';
import { NavigationModule } from '../../ui/navigation.js';
import { FALLBACK, paletteFromImage } from '../../ui/palette.js';
import { trackVerticalDrag, shouldDismiss } from '../../ui/motion/gesture.js';
import { Spring, prefersReducedMotion, scheduler } from '../../ui/motion/spring.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { construirDiapositivas } from './diapositivas.js';
import { guardarImagen } from './imagen.js';
import { resumenDelAnio } from './datos.js';

/** Lo que dura cada diapositiva. */
export const DURACION_MS = 6_000;

/** El fragmento de la canción del año: 15 s desde el minuto 1, con fundido. */
export const FRAGMENTO = { desde: 60, duracion: 15, fundido: 1.2, volumen: 0.85 };

/** Mantener pulsado más de esto es «pausa», no «toque». */
const PULSACION_LARGA_MS = 220;

export const HistoriaModule = (() => {
    let vista = null;
    let barras = null;
    let escenario = null;
    let botonGuardar = null;

    let diapositivas = [];
    let resumen = null;
    let indice = 0;
    let abierta = false;

    // Progreso de la diapositiva actual, en milisegundos ya consumidos
    let consumido = 0;
    let ultimoCuadro = 0;
    let rafId = null;
    let pausada = false;

    let miniaturaFinal = '';
    let fragmento = null;
    let reanudarMusica = false;
    let paletaActual = FALLBACK;

    const el = (id) => document.getElementById(id);

    function montar() {
        vista = el('wrappedView');
        barras = el('wrappedBars');
        escenario = el('wrappedStage');
        botonGuardar = el('wrappedSave');
        return Boolean(vista && barras && escenario);
    }

    // ========================================
    // Música del usuario
    // ========================================

    /** true si alguna de las dos pletinas está sonando (plan 12 usa dos). */
    function musicaSonando() {
        return ['mainAudio', 'deckAudio'].some((id) => {
            const a = el(id);
            return Boolean(a && !a.paused && !a.ended && a.currentTime > 0);
        });
    }

    function pararFragmento() {
        if (!fragmento) return;
        const a = fragmento;
        fragmento = null;
        try {
            a.pause();
            a.src = '';
        } catch { /* ya estaba parado */ }
    }

    /**
     * Suena el fragmento de la canción del año, si está en la biblioteca.
     * Si no se puede (no está, o el audio no es recuperable), la diapositiva se
     * queda en silencio: no es un error que haya que contarle a nadie.
     */
    async function sonarFragmento(cancion) {
        pararFragmento();
        if (!cancion?.videoId) return;
        try {
            const biblioteca = await LibraryModule.getLibrary();
            const song = biblioteca.find((s) => s.videoId === cancion.videoId);
            if (!song) return;
            const src = await resolveStreamSrc(song);
            if (!src) return;

            const a = new Audio();
            a.src = src;
            a.volume = 0;
            fragmento = a;
            await a.play();
            if (fragmento !== a) return;   // se cambió de diapositiva mientras cargaba

            // Desde el minuto 1, salvo que la canción no llegue: entonces, del principio
            a.currentTime = Number.isFinite(a.duration) && a.duration > FRAGMENTO.desde + FRAGMENTO.duracion
                ? FRAGMENTO.desde : 0;
            fundir(a, FRAGMENTO.volumen);
            setTimeout(() => { if (fragmento === a) fundir(a, 0, () => pararFragmento()); },
                (FRAGMENTO.duracion - FRAGMENTO.fundido) * 1000);
        } catch {
            pararFragmento();
        }
    }

    /** Sube o baja el volumen poco a poco: cortar en seco se oye como un chasquido. */
    function fundir(audio, hasta, alAcabar) {
        const desde = audio.volume;
        const pasos = 24;
        let paso = 0;
        const tic = setInterval(() => {
            paso++;
            if (!fragmento || fragmento !== audio) {
                clearInterval(tic);
                return;
            }
            audio.volume = Math.max(0, Math.min(1, desde + (hasta - desde) * (paso / pasos)));
            if (paso >= pasos) {
                clearInterval(tic);
                alAcabar?.();
            }
        }, (FRAGMENTO.fundido * 1000) / pasos);
    }

    // ========================================
    // Colores
    // ========================================

    // paletteFromImage ya devuelve los tres colores en hexadecimal, y el oscuro
    // ya viene bajado de luminancia para que se lea encima: se asignan tal cual,
    // igual que hace el fondo del reproductor (plan 09, T11).
    async function aplicarPaleta(miniatura) {
        paletaActual = (miniatura ? await paletteFromImage(miniatura) : null) ?? FALLBACK;
        const nombres = ['--wrapped-claro', '--wrapped-medio', '--wrapped-oscuro'];
        nombres.forEach((nombre, i) => vista.style.setProperty(nombre, paletaActual[i]));
    }

    // ========================================
    // Pintado
    // ========================================

    function pintarBarras() {
        barras.innerHTML = html`${diapositivas.map(() => html`<span class="wrapped-bar"><i></i></span>`)}`.toString();
        barras.setAttribute('aria-hidden', 'true');
    }

    function marcarBarras() {
        [...barras.children].forEach((barra, i) => {
            const relleno = barra.firstElementChild;
            if (!relleno) return;
            if (i < indice) relleno.style.width = '100%';
            else if (i > indice) relleno.style.width = '0%';
        });
    }

    function filaHtml(f) {
        return html`<li class="wrapped-row">
            <span class="wrapped-pos">${f.posicion}</span>
            ${f.miniatura ? html`<img class="wrapped-thumb" src="${f.miniatura}" alt="" loading="lazy">` : ''}
            <span class="wrapped-row-text">
                <strong>${f.principal}</strong>
                <small>${f.secundario}</small>
            </span>
        </li>`;
    }

    function barraHtml(b, maximo) {
        const alto = maximo > 0 ? Math.max(4, Math.round((b.minutos / maximo) * 100)) : 4;
        return html`<li class="wrapped-band${b.destacada ? ' is-top' : ''}">
            <i style="height:${alto}%"></i>
            <span>${b.etiqueta}</span>
        </li>`;
    }

    function diapositivaHtml(d) {
        const maximo = d.barras ? Math.max(...d.barras.map((b) => b.minutos), 0) : 0;
        return html`<section class="wrapped-slide" data-slide="${d.id}">
            <h2 class="wrapped-slide-title" id="wrappedTitle">${d.titulo}</h2>
            ${d.miniatura ? html`<img class="wrapped-cover" src="${d.miniatura}" alt="">` : ''}
            ${d.destacado ? html`<p class="wrapped-highlight">
                <span class="wrapped-value"${d.destacado.contar ? seguro(' data-contar="1"') : ''}
                      data-valor="${d.destacado.valor}">${d.destacado.valor}</span>
                ${d.destacado.sufijo ? html`<small>${d.destacado.sufijo}</small>` : ''}
            </p>` : ''}
            ${d.detalle ? html`<p class="wrapped-detail">${d.detalle}</p>` : ''}
            ${d.lista ? html`<ol class="wrapped-list">${d.lista.map(filaHtml)}</ol>` : ''}
            ${d.barras ? html`<ul class="wrapped-bands">${d.barras.map((b) => barraHtml(b, maximo))}</ul>` : ''}
        </section>`;
    }

    /** Anima los números que cuentan hasta su valor. Con «Reducir movimiento», los deja puestos. */
    function animarNumeros(seccion) {
        for (const nodo of seccion.querySelectorAll('[data-contar]')) {
            const destino = Number(nodo.dataset.valor);
            if (!Number.isFinite(destino)) continue;
            if (prefersReducedMotion()) {
                nodo.textContent = String(destino);
                continue;
            }
            nodo.textContent = '0';
            const muelle = new Spring({
                value: 0,
                preset: 'smooth',
                onUpdate: (v) => { nodo.textContent = String(Math.round(v)); },
            });
            muelle.to(destino).then(() => { nodo.textContent = String(destino); }).catch(() => {});
        }
    }

    /** Entrada escalonada de las filas y las barras, si hay movimiento. */
    function escalonar(seccion) {
        if (prefersReducedMotion()) return;
        const hijos = seccion.querySelectorAll('.wrapped-row, .wrapped-band');
        hijos.forEach((hijo, i) => {
            hijo.style.animationDelay = `${Math.min(i, 8) * 60}ms`;
            hijo.classList.add('wrapped-enters');
        });
    }

    async function pintarDiapositiva() {
        const d = diapositivas[indice];
        if (!d) return;
        escenario.innerHTML = diapositivaHtml(d).toString();
        const seccion = escenario.firstElementChild;
        if (seccion) {
            animarNumeros(seccion);
            escalonar(seccion);
        }
        botonGuardar?.classList.toggle('hidden', d.id !== 'final');
        if (d.id === 'final') miniaturaFinal = d.resumen?.miniatura ?? '';
        marcarBarras();
        if (d.miniatura) await aplicarPaleta(d.miniatura);
        if (d.cancion) sonarFragmento(d.cancion);
        else pararFragmento();
    }

    // ========================================
    // Avance
    // ========================================

    function detenerReloj() {
        if (rafId !== null) {
            scheduler.cancel(rafId);
            rafId = null;
        }
    }

    // El reloj va por el scheduler del plan 09, no por requestAnimationFrame a
    // pelo: así hereda su respaldo cuando no hay rAF y el modo de depuración
    // lento afecta también a la historia.
    function cuadro(marca) {
        rafId = null;
        if (!abierta) return;
        // requestAnimationFrame pasa la marca de tiempo, pero algunos sustitutos
        // (y los entornos de prueba) llaman sin argumento: sin este respaldo el
        // progreso se volvería NaN y la historia no avanzaría nunca.
        const ahora = typeof marca === 'number' && Number.isFinite(marca) ? marca : scheduler.now();
        if (!pausada) {
            consumido += Math.max(0, ahora - ultimoCuadro);
            const relleno = barras.children[indice]?.firstElementChild;
            if (relleno) relleno.style.width = `${Math.min(100, (consumido / DURACION_MS) * 100)}%`;
            if (consumido >= DURACION_MS) {
                siguiente();
                return;
            }
        }
        ultimoCuadro = ahora;
        rafId = scheduler.request(cuadro);
    }

    function arrancarReloj() {
        detenerReloj();
        consumido = 0;
        ultimoCuadro = scheduler.now();
        rafId = scheduler.request(cuadro);
    }

    async function ir(nuevo) {
        if (nuevo < 0) return;
        if (nuevo >= diapositivas.length) {
            // La última no se cierra sola: se queda, que es donde está «Guardar imagen»
            pausada = true;
            const relleno = barras.children[indice]?.firstElementChild;
            if (relleno) relleno.style.width = '100%';
            detenerReloj();
            return;
        }
        indice = nuevo;
        await pintarDiapositiva();
        pausada = false;
        arrancarReloj();
    }

    const siguiente = () => ir(indice + 1);
    const anterior = () => ir(Math.max(0, indice - 1));

    function pausar() {
        pausada = true;
        vista.classList.add('is-paused');
        if (fragmento) { try { fragmento.pause(); } catch { /* da igual */ } }
    }

    function reanudar() {
        if (!abierta) return;
        pausada = false;
        vista.classList.remove('is-paused');
        ultimoCuadro = scheduler.now();
        if (fragmento) { fragmento.play().catch(() => {}); }
        if (rafId === null) rafId = scheduler.request(cuadro);
    }

    // ========================================
    // Gestos y teclado
    // ========================================

    let enlazado = false;

    function enlazar() {
        if (enlazado) return;
        enlazado = true;

        let pulsadoEn = 0;
        let pausadoPorPulsacion = false;
        let temporizadorPulsacion = null;

        const empezarPulsacion = (ev) => {
            pulsadoEn = Date.now();
            pausadoPorPulsacion = false;
            temporizadorPulsacion = setTimeout(() => {
                pausadoPorPulsacion = true;
                pausar();
            }, PULSACION_LARGA_MS);
            // El toque decide al levantar: así una pulsación larga no avanza
            ev.preventDefault?.();
        };

        const acabarPulsacion = (ev, haciaAdelante) => {
            clearTimeout(temporizadorPulsacion);
            if (pausadoPorPulsacion) {
                pausadoPorPulsacion = false;
                reanudar();
                return;
            }
            if (Date.now() - pulsadoEn < PULSACION_LARGA_MS) {
                if (haciaAdelante) siguiente();
                else anterior();
            }
            ev.preventDefault?.();
        };

        for (const [id, haciaAdelante] of [['wrappedNext', true], ['wrappedPrev', false]]) {
            const zona = el(id);
            if (!zona) continue;
            zona.addEventListener('pointerdown', empezarPulsacion);
            zona.addEventListener('pointerup', (ev) => acabarPulsacion(ev, haciaAdelante));
            zona.addEventListener('pointercancel', () => {
                clearTimeout(temporizadorPulsacion);
                if (pausadoPorPulsacion) { pausadoPorPulsacion = false; reanudar(); }
            });
        }

        el('wrappedClose')?.addEventListener('click', () => cerrar());

        botonGuardar?.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            // Mientras se dibuja, la historia se queda quieta: si avanzase, la
            // imagen saldría con la paleta de otra diapositiva
            pausar();
            botonGuardar.disabled = true;
            try {
                const donde = await guardarImagen(resumen, paletaActual, { miniatura: miniaturaFinal });
                avisar(donde ? i18n.t('wrapped_saved', { donde }) : i18n.t('wrapped_save_failed'));
            } catch (e) {
                console.debug('[Resumen] No se pudo guardar la imagen:', e);
                avisar(i18n.t('wrapped_save_failed'));
            } finally {
                botonGuardar.disabled = false;
            }
        });

        // Deslizar hacia abajo cierra, como las hojas del plan 09
        trackVerticalDrag(vista, {
            canStart: () => abierta,
            onStart: () => pausar(),
            onMove: ({ offset }) => {
                if (offset > 0) vista.style.transform = `translateY(${offset}px)`;
            },
            onEnd: ({ offset, velocity }) => {
                vista.style.transform = '';
                if (offset > 0 && shouldDismiss({ offset, velocity, size: vista.offsetHeight || 800 })) cerrar();
                else reanudar();
            },
        });

        document.addEventListener('keydown', (ev) => {
            if (!abierta) return;
            if (ev.key === 'Escape') { cerrar(); return; }
            if (ev.key === 'ArrowRight') { siguiente(); return; }
            if (ev.key === 'ArrowLeft') { anterior(); return; }
            if (ev.key === ' ') {
                ev.preventDefault();
                if (pausada) reanudar(); else pausar();
            }
        });
    }

    // ========================================
    // Abrir y cerrar
    // ========================================

    /** Pantalla de «todavía no hay suficiente música», con cuánto falta. */
    function pintarInsuficiente(r) {
        barras.innerHTML = '';
        botonGuardar?.classList.add('hidden');
        escenario.innerHTML = html`<section class="wrapped-slide wrapped-empty">
            <h2 class="wrapped-slide-title" id="wrappedTitle">${i18n.t('wrapped_not_enough_title')}</h2>
            <p class="wrapped-detail">${i18n.t('wrapped_not_enough_detail', {
                minutos: r.faltan?.minutos ?? 0, escuchas: r.faltan?.escuchas ?? 0,
            })}</p>
        </section>`.toString();
    }

    /**
     * Abre la historia del año. Devuelve el resumen que ha usado, para los tests
     * y para quien quiera saber si había bastante música.
     */
    async function abrir(anio = new Date().getFullYear()) {
        if (!montar()) return null;
        if (abierta) return resumen;

        resumen = await resumenDelAnio(anio);
        diapositivas = construirDiapositivas(resumen, (clave, params) => i18n.t(clave, params));

        abierta = true;
        indice = 0;
        pausada = false;
        enlazar();

        // La música del usuario se aparta: la historia tiene su propio sonido
        reanudarMusica = musicaSonando();
        if (reanudarMusica) PlayerModule.pause();

        vista.classList.remove('hidden');
        vista.setAttribute('aria-hidden', 'false');
        document.body.classList.add('wrapped-open');
        // El apunte en el historial es para que «atrás» cierre la capa en vez de
        // salir de la app. Si falla (sin History API), la historia se abre igual:
        // no vale la pena impedirlo por la contabilidad de la navegación.
        try { NavigationModule.pushOverlayState('wrappedView'); } catch { /* sin historial */ }

        if (!resumen.suficiente || !diapositivas.length) {
            pintarInsuficiente(resumen);
            return resumen;
        }

        pintarBarras();
        await pintarDiapositiva();
        arrancarReloj();
        return resumen;
    }

    function cerrar() {
        if (!abierta) return;
        abierta = false;
        detenerReloj();
        pararFragmento();
        vista.classList.add('hidden');
        vista.classList.remove('is-paused');
        vista.style.transform = '';
        vista.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('wrapped-open');
        try { NavigationModule.olvidarOverlay('wrappedView'); } catch { /* sin historial */ }
        if (reanudarMusica) {
            reanudarMusica = false;
            PlayerModule.resume();
        }
    }

    return {
        abrir,
        cerrar,
        siguiente,
        anterior,
        pausar,
        reanudar,
        estaAbierta: () => abierta,
        indiceActual: () => indice,
        cuantasDiapositivas: () => diapositivas.length,
        resumenActual: () => resumen,
        paleta: () => paletaActual,
    };
})();
