/**
 * Letras sincronizadas (lrclib).
 */

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

    const lyricsSection = document.getElementById('lyricsSection');
    const lyricsContent = document.getElementById('lyricsContent');
    const lyricsToggle = document.getElementById('lyricsToggle');

    // ── Desplazamiento con muelle (plan 09, T12) ──
    // La línea activa queda al 35 % de la altura. Solo se mueve el scrollTop
    // de la caja de letras: scrollIntoView podía arrastrar también el
    // contenedor del reproductor, que tiene su propio scroll entre vistas.
    const ANCLA_LETRAS = 0.35;
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
                const text = match[4].trim();
                if (text) {
                    parsed.push({ time, text });
                }
            }
        }

        return parsed.sort((a, b) => a.time - b.time);
    }

    // Fetch lyrics from LRCLIB API
    async function fetchLyrics(title, artist) {
        if (!title) return null;

        // Clean title: remove common noise like "(Official Video)", "[Lyrics]", etc.
        const cleanTitle = title
            .replace(/\((?:official|lyric|audio|video|hd|hq|4k|visualizer|ft\.?|feat\.?).*?\)/gi, '')
            .replace(/\[(?:official|lyric|audio|video|hd|hq|4k).*?\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const cleanArtist = (artist || '')
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/VEVO$/i, '')
            .trim();

        try {
            // Try synced search first
            const params = new URLSearchParams({
                track_name: cleanTitle,
                artist_name: cleanArtist
            });

            const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);

            if (!response.ok) return null;

            const results = await response.json();

            if (results && results.length > 0) {
                // Prefer synced lyrics over plain
                const synced = results.find(r => r.syncedLyrics);
                if (synced?.syncedLyrics) {
                    return { type: 'synced', data: parseLRC(synced.syncedLyrics) };
                }
                // Fall back to plain lyrics
                const plain = results.find(r => r.plainLyrics);
                if (plain?.plainLyrics) {
                    return { type: 'plain', data: plain.plainLyrics };
                }
            }
        } catch (err) {
            console.warn('[Lyrics] Fetch error:', err);
        }

        return null;
    }

    // Render lyrics into the DOM
    function renderLyrics(lyrics) {
        if (!lyricsContent) return;

        if (!lyrics) {
            lyricsContent.innerHTML = '<p class="lyrics-empty">No lyrics found for this track</p>';
            return;
        }

        if (lyrics.type === 'plain') {
            lyricsContent.innerHTML = lyrics.data
                .split('\n')
                .filter(l => l.trim())
                .map(l => `<p class="lyrics-line plain">${l}</p>`)
                .join('');
            return;
        }

        // Synced lyrics
        currentLyrics = lyrics.data;
        lyricsContent.innerHTML = currentLyrics
            .map((l, i) => `<p class="lyrics-line" data-time="${l.time}" data-index="${i}">${l.text}</p>`)
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

        const lines = lyricsContent.querySelectorAll('.lyrics-line');
        lines.forEach((el, i) => {
            el.classList.toggle('active', i === activeIndex);
            el.classList.toggle('past', i < activeIndex);
            // Profundidad: cuanto más lejos de la activa, más tenue y difusa
            const d = activeIndex < 0 ? 5 : Math.abs(i - activeIndex);
            el.dataset.d = d <= 4 ? String(d) : 'lejos';
        });

        // Auto-scroll to active line with user interaction detection
        if (activeIndex >= 0 && lines[activeIndex]) {
            const activeIndexChanged = (activeIndex !== lastActiveIndex);
            const userScrollTimeoutActive = (Date.now() - lastUserScrollTime < 5000);

            // Should scroll if:
            // 1. Line changed AND user hasn't scrolled manually recently.
            // 2. OR user went idle (scroll timeout just expired) so we snap back smoothly.
            const shouldScroll = (activeIndexChanged && !userScrollTimeoutActive) ||
                (!userScrollTimeoutActive && lastUserScrollTimeoutActive);

            if (shouldScroll && lyricsVisible) {
                llevarA(lines[activeIndex]);
            }

            lastActiveIndex = activeIndex;
            lastUserScrollTimeoutActive = userScrollTimeoutActive;
        }
    }

    // Called when a new song starts playing
    async function onTrackChange(title, artist) {
        const trackKey = `${title}|${artist}`;
        if (trackKey === currentTrackKey) return;
        currentTrackKey = trackKey;

        if (lyricsContent) {
            lyricsContent.innerHTML = '<p class="lyrics-empty">Searching for lyrics...</p>';
        }

        const lyrics = await fetchLyrics(title, artist);

        // Verify we're still on the same track
        if (`${title}|${artist}` !== currentTrackKey) return;

        renderLyrics(lyrics);

        // Show lyrics section if we found them
        if (lyrics && lyricsSection) {
            lyricsSection.classList.remove('hidden');
        }
    }

    return {
        onTrackChange,
        updateActiveLine,
        get visible() { return lyricsVisible; }
    };
})();
