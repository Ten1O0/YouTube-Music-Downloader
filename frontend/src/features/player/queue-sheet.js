/**
 * La hoja de la cola: lo que suena, lo que va a continuación y el resto de la
 * cola, con aleatorio y repetición.
 *
 * El estado es del reproductor; la hoja lo lee y lo cambia a través de las
 * funciones que recibe. `siguientes()` devuelve la lista «a continuación» del
 * reproductor, no una copia: quitar una canción aquí la quita de verdad.
 */

import { nombreDe } from '../../core/titles.js';
import { estadoVacio } from '../../ui/empty-states.js';
import { html, seguro } from '../../core/html.js';
import { animateListChange, measure } from '../../ui/motion/list.js';
import { NavigationModule } from '../../ui/navigation.js';
import { syncRepeatButtonState } from './ui.js';

export function createQueueSheet({ cola, siguientes, indice, fijarIndice, aleatorio, repeticion, play, toggleShuffle, toggleRepeat }) {
    const fullPlayerQueue = document.getElementById('fullPlayerQueue');
    const pqSheet = document.getElementById('playbackQueueSheet');
    const pqBackdrop = pqSheet?.querySelector('.pq-backdrop');
    const pqCloseBtn = document.getElementById('pqCloseBtn');
    const pqShuffleBtn = document.getElementById('pqShuffleBtn');
    const pqRepeatBtn = document.getElementById('pqRepeatBtn');
    const pqNowPlaying = document.getElementById('pqNowPlaying');
    const pqNextList = document.getElementById('pqNextList');
    const pqNextSection = document.getElementById('pqNextSection');
    const pqQueueList = document.getElementById('pqQueueList');

    function renderQueueItem(song, isNowPlaying, pos = -1) {
        const playing = isNowPlaying ? ' is-playing' : '';
        const bars = isNowPlaying ? seguro('<div class="pq-playing-bars"><span></span><span></span><span></span></div>') : '';
        return html`<div class="pq-item${playing}" data-src="${song.src || ''}" data-pos="${pos}">
            <img class="pq-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" width="32" height="32" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
            <div class="pq-item-info">
                <div class="pq-item-title">${nombreDe(song).titulo}</div>
                <div class="pq-item-artist">${nombreDe(song).artista || 'Desconocido'}</div>
            </div>
            ${bars}
        </div>`;
    }

    function renderNextUpQueueSection(pqNextSection, pqNextList) {
        if (!pqNextSection || !pqNextList) return;
        if (siguientes().length > 0) {
            pqNextSection.style.display = '';
            const antesSiguientes = measure(pqNextList, '.pq-item', el => el.dataset.src);
            pqNextList.innerHTML = siguientes().map((s, i) => {
                return html`<div class="pq-item" data-next-index="${i}" data-src="${s.src || ''}">
                    <img class="pq-item-thumb" src="${s.thumbnail || 'favicon.png'}" alt="" width="32" height="32" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
                    <div class="pq-item-info">
                        <div class="pq-item-title">${nombreDe(s).titulo}</div>
                        <div class="pq-item-artist">${nombreDe(s).artista || 'Desconocido'}</div>
                    </div>
                    <button class="pq-item-remove" data-next-remove="${i}" title="Quitar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
            }).join('');
            animateListChange(pqNextList, '.pq-item', el => el.dataset.src, antesSiguientes);
        } else {
            pqNextSection.style.display = 'none';
        }
    }

    function renderMainQueueSection(pqQueueList, q) {
        if (!pqQueueList) return;
        const upcoming = [];
        for (let i = 1; i < q.length; i++) {
            const idx = (indice() + i) % q.length;
            upcoming.push(q[idx]);
        }
        if (upcoming.length > 0) {
            const antes = measure(pqQueueList, '.pq-item', el => el.dataset.src);
            pqQueueList.innerHTML = upcoming.map((s, i) => renderQueueItem(s, false, i)).join('');
            animateListChange(pqQueueList, '.pq-item', el => el.dataset.src, antes);
        } else {
            pqQueueList.replaceChildren(estadoVacio({ ilustracion: 'cola', titulo: 'empty_queue_t', compacto: true }));
        }
    }

    function renderQueuePanel() {
        if (!pqSheet) return;
        const q = cola();
        const current = q[indice()];

        // Now Playing
        if (pqNowPlaying) {
            if (current) pqNowPlaying.innerHTML = renderQueueItem(current, true);
            else pqNowPlaying.replaceChildren(estadoVacio({ ilustracion: 'cola', titulo: 'empty_now_t', compacto: true }));
        }

        // Render sections via helpers
        renderNextUpQueueSection(pqNextSection, pqNextList);
        renderMainQueueSection(pqQueueList, q);

        // Sync shuffle/repeat button states using the repeat state helper
        if (pqShuffleBtn) pqShuffleBtn.classList.toggle('active', aleatorio());
        syncRepeatButtonState(pqRepeatBtn, repeticion());
    }

    function openQueuePanel() {
        if (!pqSheet) return;
        renderQueuePanel();
        pqSheet.classList.remove('hidden');
        NavigationModule.pushOverlayState('playbackQueueSheet');
    }

    function closeQueuePanel() {
        if (pqSheet) pqSheet.classList.add('hidden');
    }

    // Un escuchador por lista, una sola vez (plan 19, T4): antes, uno por fila
    // y por botón, creados otra vez cada vez que se abría la cola
    pqNextList?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-next-remove]');
        if (!btn) return;
        e.stopPropagation();
        siguientes().splice(Number.parseInt(btn.dataset.nextRemove, 10), 1);
        renderQueuePanel();
    });
    pqQueueList?.addEventListener('click', (e) => {
        const el = e.target.closest('.pq-item');
        const pos = Number.parseInt(el?.dataset.pos ?? '-1', 10);
        const q = cola();
        if (pos < 0 || !q.length) return;
        const realIdx = (indice() + pos + 1) % q.length;
        play(q[realIdx]);
        fijarIndice(realIdx);
        renderQueuePanel();
    });

    // Botones
    if (fullPlayerQueue) {
        fullPlayerQueue.addEventListener('click', () => openQueuePanel());
    }
    if (pqCloseBtn) {
        pqCloseBtn.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }
    if (pqBackdrop) {
        pqBackdrop.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }
    if (pqShuffleBtn) {
        pqShuffleBtn.addEventListener('click', () => {
            toggleShuffle();
            renderQueuePanel();
        });
    }
    if (pqRepeatBtn) {
        pqRepeatBtn.addEventListener('click', () => {
            toggleRepeat();
            renderQueuePanel();
        });
    }

    return { renderQueuePanel, openQueuePanel, closeQueuePanel };
}
