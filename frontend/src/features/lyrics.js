/**
 * Letras sincronizadas (lrclib).
 */

import { nombreDe } from '../core/titles.js';
import { conEsqueleto } from '../ui/skeleton.js';
import { estadoVacio } from '../ui/empty-states.js';
import { html } from '../core/html.js';
import { PlayerModule } from './player/player.js';
import { Spring } from '../ui/motion/spring.js';

// ========================================
// 🟢 NEW: Lyrics Module (LRCLIB API)
// Fetches synchronized lyrics and displays them in the full player
// ========================================
export const LyricsModule = (() => {
    let currentLyrics = [];
    let lyricsVisible = false;
    let currentTrackKey = '';

    // Auto-scroll tracking variables
    let lastUserScrollTime = 0;
    let lastActiveIndex = -1;
    let lastUserScrollTimeoutActive = false;
    // Lo último que se pintó en las líneas (ver updateActiveLine)
    let indicePintado = null, primeraPintada = null, lineasPintadas = 0;

    const lyricsSection = document.getElementById('lyricsSection');
    const lyricsContent = document.getElementById('lyricsContent');
    const lyricsToggle = document.getElementById('lyricsToggle');

    // ── Desplazamiento con muelle (plan 09, T12) ──
    // La línea activa queda al 35 % de la altura. Solo se mueve el scrollTop
    // de la caja de letras: scrollIntoView podía arrastrar también el
    // contenedor del reproductor, que tiene su propio scroll entre vistas.
    const ANCLA_LETRAS = 0.35;
    // Búsqueda de la letra (plan 22, §2.5)
    const REINTENTOS_MS = [1500, 4000];
    const LIMITE_CONSULTA_MS = 8000;
    const MAX_CONSULTAS = 5;
    const muelleLetras = new Spring({
        value: 0, preset: 'smooth', precision: 0.5,
        onUpdate: (y) => { if (lyricsSection) lyricsSection.scrollTop = y; },
    });

    function llevarA(linea, { animar = true } = {}) {
        if (!lyricsSection || !linea) return;
        const max = Math.max(0, lyricsSection.scrollHeight - lyricsSection.clientHeight);
        const destino = Math.max(0, Math.min(max, linea.offsetTop - lyricsSection.clientHeight * ANCLA_LETRAS));
        // Si ya se estaba moviendo, se redirige conservando la velocidad
        if (!muelleLetras.animating) muelleLetras.jump(lyricsSection.scrollTop);
        if (animar) muelleLetras.to(destino);
        else muelleLetras.jump(destino);
    }

    // Se detecta la intención del usuario (rueda o dedo desplazando), no los
    // eventos de scroll: antes, el propio auto-desplazamiento disparaba decenas
    // de eventos y se tomaba por el usuario, pausando el seguimiento 5 s tras
    // cada línea.
    if (lyricsSection) {
        const mandaElUsuario = () => {
            lastUserScrollTime = Date.now();
            muelleLetras.stop();
            // Mientras lee por su cuenta, todo nítido (plan 23)
            lyricsSection.classList.add('leyendo');
        };
        lyricsSection.addEventListener('wheel', mandaElUsuario, { passive: true });
        lyricsSection.addEventListener('touchmove', mandaElUsuario, { passive: true });
    }

    // Toggle lyrics view scroll snap
    if (lyricsToggle) {
        lyricsToggle.addEventListener('click', () => {
            const lyricsView = document.querySelector('.full-player-lyrics-view');
            const mainView = document.querySelector('.full-player-main-view');
            const content = document.querySelector('.full-player-content');
            if (content && lyricsView && mainView) {
                const isBottom = content.scrollTop >= content.clientHeight * 0.4;
                const targetView = isBottom ? mainView : lyricsView;
                targetView.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Back to player from lyrics header
    const lyricsBackBtn = document.getElementById('lyricsBackBtn');
    if (lyricsBackBtn) {
        lyricsBackBtn.addEventListener('click', () => {
            const mainView = document.querySelector('.full-player-main-view');
            if (mainView) {
                mainView.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Detect scroll to toggle button state dynamically
    const fpContent = document.querySelector('.full-player-content');
    if (fpContent && lyricsToggle) {
        fpContent.addEventListener('scroll', () => {
            const isBottom = fpContent.scrollTop >= fpContent.clientHeight * 0.4;
            lyricsToggle.classList.toggle('active', isBottom);
            
            const wasVisible = lyricsVisible;
            lyricsVisible = isBottom;

            // Al aparecer la vista de letras, si la última vez no se pudo buscar
            if (lyricsVisible && !wasVisible) reintentarSiFallo();
            // Al aparecer la vista de letras, ya está en la línea activa
            if (lyricsVisible && !wasVisible && lastActiveIndex >= 0) {
                const lines = lyricsContent.querySelectorAll('.lyrics-line');
                llevarA(lines[lastActiveIndex], { animar: false });
            }
        });
    }

    // Parse LRC format "[mm:ss.xx] text"
    function parseLRC(lrcText) {
        if (!lrcText) return [];
        const lines = lrcText.split('\n');
        const parsed = [];

        for (const line of lines) {
            const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const ms = parseInt(match[3].padEnd(3, '0'));
                const time = minutes * 60 + seconds + ms / 1000;
                // «LRC mejorado» (algunas de LRCLIB): una marca por palabra,
                // «<00:20.05>es <00:20.31>que». Se quitan: la línea se lee entera
                const text = match[4].replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '').replace(/\s{2,}/g, ' ').trim();
                if (text) {
                    parsed.push({ time, text });
                }
            }
        }

        return parsed.sort((a, b) => a.time - b.time);
    }

    // ── Buscar la letra en LRCLIB (plan 22) ──
    // La cascada de consultas y la elección son de letras/elegir.js; aquí, la
    // red: reintentos cuando LRCLIB está ocupado, límite de tiempo y cancelar
    // lo pendiente si cambia la canción. Nada se guarda (§2.2 del plan).

    /** Espera, o se corta si se cancela la búsqueda. */
    const esperar = (ms, senal) => new Promise((ok, ko) => {
        const reloj = setTimeout(ok, ms);
        senal.addEventListener('abort', () => { clearTimeout(reloj); ko(senal.reason); }, { once: true });
    });

    /**
     * Una consulta, con dos reintentos si LRCLIB está ocupado (503, 429) o
     * falla la red. Devuelve los resultados, [] si no hay nada que buscar, o
     * null si no se ha podido preguntar. Sin cabeceras propias: una cabecera
     * nueva obligaría a una consulta previa de CORS (§2.5).
     */
    async function consultarLrclib(params, senal) {
        for (let intento = 0; ; intento++) {
            const limite = new AbortController();
            const reloj = setTimeout(() => limite.abort(), LIMITE_CONSULTA_MS);
            const cortar = () => limite.abort();
            senal.addEventListener('abort', cortar, { once: true });
            try {
                const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, { signal: limite.signal });
                if (res.ok) {
                    const datos = await res.json();
                    return Array.isArray(datos) ? datos : [];
                }
                // Un 4xx que no es de «vuelve luego»: no hay nada que buscar así
                if (res.status < 500 && res.status !== 429) return [];
            } catch (e) {
                if (senal.aborted) throw e;
            } finally {
                clearTimeout(reloj);
                senal.removeEventListener('abort', cortar);
            }
            if (intento >= REINTENTOS_MS.length) return null;
            await esperar(REINTENTOS_MS[intento], senal);
        }
    }

    /**
     * La letra de una canción: { estado: 'ok', letra }, { estado: 'vacia' } si
     * LRCLIB no la tiene, o { estado: 'error' } si no se ha podido preguntar.
     */
    async function buscarLetra(song, senal) {
        // Se carga al buscar la primera letra, no al arrancar (presupuesto del plan 19)
        const { consultasDeLetra, elegirLetra } = await import('./letras/elegir.js');
        for (const { paso, params } of consultasDeLetra(song).slice(0, MAX_CONSULTAS)) {
            const resultados = await consultarLrclib(params, senal);
            // LRCLIB caído o sin red: seguir preguntando solo lo cargaría más
            if (resultados === null) return { estado: 'error' };
            const elegida = elegirLetra(resultados, song, paso);
            if (!elegida) continue;
            if (elegida.tipo === 'synced') {
                const lineas = parseLRC(elegida.texto);
                if (lineas.length) return { estado: 'ok', letra: { type: 'synced', data: lineas } };
            } else if (elegida.texto?.trim()) {
                return { estado: 'ok', letra: { type: 'plain', data: elegida.texto } };
            }
        }
        return { estado: 'vacia' };
    }

    // Render lyrics into the DOM
    function renderLyrics(lyrics, estado = 'ok') {
        if (!lyricsContent) return;
        // La sincronizada anterior no puede seguir marcando líneas (updateActiveLine)
        currentLyrics = [];

        if (!lyrics) {
            // «No se pudo buscar» no es «no hay letra»: lo primero se reintenta solo
            const [titulo, texto] = estado === 'error' ? ['lyrics_error_t', 'lyrics_error_d'] : ['empty_lyrics_t', 'empty_lyrics_d'];
            lyricsContent.replaceChildren(estadoVacio({ ilustracion: 'letras', titulo, texto }));
            return;
        }

        if (lyrics.type === 'plain') {
            lyricsContent.innerHTML = lyrics.data
                .split('\n')
                .filter(l => l.trim())
                .map(l => html`<p class="lyrics-line plain">${l}</p>`)
                .join('');
            return;
        }

        // Synced lyrics
        currentLyrics = lyrics.data;
        lyricsContent.innerHTML = currentLyrics
            .map((l, i) => html`<p class="lyrics-line" data-time="${l.time}" data-index="${i}">${l.text}</p>`)
            .join('');

        // Click to seek
        lyricsContent.querySelectorAll('.lyrics-line[data-time]').forEach(el => {
            el.addEventListener('click', () => {
                const time = Number.parseFloat(el.dataset.time);
                if (typeof PlayerModule.seekTo === 'function') {
                    PlayerModule.seekTo(time);
                }
                // Tocar una línea vuelve a activar el seguimiento y la lleva a su sitio
                lastUserScrollTime = 0;
                llevarA(el);
                el.classList.remove('tocada'); void el.offsetWidth; el.classList.add('tocada');
            });
        });
    }

    // Update active lyric line based on current time
    function updateActiveLine(currentTime) {
        if (!currentLyrics.length || !lyricsContent) return;

        let activeIndex = -1;
        for (let i = currentLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= currentLyrics[i].time) {
                activeIndex = i;
                break;
            }
        }

        // El tiempo llega 4 veces por segundo, pero la línea cambia cada pocos
        // segundos: solo entonces se tocan las clases (plan 19, T13). Si la
        // letra se ha vuelto a pintar, su primera línea es otra y se repinta.
        const primera = lyricsContent.firstElementChild;
        let lines = null;
        if (activeIndex !== indicePintado || primera !== primeraPintada) {
            lines = lyricsContent.querySelectorAll('.lyrics-line');
            lines.forEach((el, i) => {
                el.classList.toggle('active', i === activeIndex);
                el.classList.toggle('past', i < activeIndex);
                // Profundidad: cuanto más lejos de la activa, más tenue y difusa
                const d = activeIndex < 0 ? 5 : Math.abs(i - activeIndex);
                el.dataset.d = d <= 4 ? String(d) : 'lejos';
            });
            indicePintado = activeIndex;
            primeraPintada = primera;
            lineasPintadas = lines.length;
        }

        // Auto-scroll to active line with user interaction detection
        if (activeIndex >= 0 && activeIndex < lineasPintadas) {
            const activeIndexChanged = (activeIndex !== lastActiveIndex);
            const userScrollTimeoutActive = (Date.now() - lastUserScrollTime < 5000);
            // Pasados 5 s sin tocarla, vuelve a seguir la canción y a difuminar
            if (!userScrollTimeoutActive) lyricsSection?.classList.remove('leyendo');

            // Should scroll if:
            // 1. Line changed AND user hasn't scrolled manually recently.
            // 2. OR user went idle (scroll timeout just expired) so we snap back smoothly.
            const shouldScroll = (activeIndexChanged && !userScrollTimeoutActive) ||
                (!userScrollTimeoutActive && lastUserScrollTimeoutActive);

            if (shouldScroll && lyricsVisible) {
                lines ??= lyricsContent.querySelectorAll('.lyrics-line');
                llevarA(lines[activeIndex]);
            }

            lastActiveIndex = activeIndex;
            lastUserScrollTimeoutActive = userScrollTimeoutActive;
        }
    }

    // ── Cuándo se busca ──
    let busqueda = null;          // el AbortController de la búsqueda en curso
    let cancionBuscada = null;
    let duracionBuscada = null;
    let ultimoEstado = null;      // 'ok' | 'vacia' | 'error'

    /**
     * Al empezar una canción y al cambiar su nombre en el editor (plan 22, T4):
     * la clave lleva el nombre, así que editarlo vuelve a buscar. Si la última
     * vez no se pudo preguntar, se vuelve a intentar aunque sea la misma.
     */
    async function onTrackChange(song, duracionAudio = null) {
        if (!song) return;
        const { titulo, artista } = nombreDe(song);
        const trackKey = `${song.videoId || song.src}|${titulo}|${artista}`;
        if (trackKey === currentTrackKey && ultimoEstado !== 'error') return;
        currentTrackKey = trackKey;
        cancionBuscada = song;
        duracionBuscada = duracionAudio;

        // Lo que se buscaba para la anterior ya no sirve
        busqueda?.abort();
        const esta = busqueda = new AbortController();

        // Líneas con forma mientras se busca la letra (plan 10, T8)
        lyricsContent?.replaceChildren();
        let r;
        try {
            const buscar = async () => buscarLetra(await conDuracion(song, duracionAudio, esta.signal), esta.signal);
            r = await conEsqueleto(lyricsContent, 'letra', 8, buscar());
        } catch (e) {
            if (esta.signal.aborted) return;
            console.warn('[Lyrics] Error al buscar la letra:', e);
            r = { estado: 'error' };
        }
        if (esta !== busqueda) return;
        busqueda = null;
        ultimoEstado = r.estado;

        renderLyrics(r.letra ?? null, r.estado);
        if (r.letra && lyricsSection) lyricsSection.classList.remove('hidden');
    }

    /**
     * La duración con la que se distinguen las versiones: la guardada o, en las
     * canciones descargadas antes de guardarla (plan 22), la del propio audio,
     * que es la más exacta. Espera a que el audio la sepa, como mucho 3 s.
     */
    async function conDuracion(song, duracionAudio, senal) {
        if (Number.isFinite(song.duration) && song.duration > 0) return song;
        for (let i = 0; i < 15 && duracionAudio; i++) {
            const d = duracionAudio();
            if (Number.isFinite(d) && d > 0) return { ...song, duration: Math.round(d) };
            await esperar(200, senal);
        }
        return song;
    }

    /** Al abrir la vista de letras: si la última vez no se pudo preguntar, otra vez. */
    function reintentarSiFallo() {
        if (ultimoEstado === 'error' && !busqueda && cancionBuscada) onTrackChange(cancionBuscada, duracionBuscada);
    }

    return {
        onTrackChange,
        updateActiveLine,
        get visible() { return lyricsVisible; }
    };
})();
