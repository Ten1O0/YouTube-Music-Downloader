/**
 * La hoja de la cola: lo que suena, lo que va a continuación y el resto de la
 * cola, con aleatorio y repetición.
 *
 * El estado es del reproductor; la hoja lo lee y lo cambia a través de las
 * funciones que recibe. `siguientes()` devuelve la lista «a continuación» del
 * reproductor, no una copia: quitar una canción aquí la quita de verdad.
 */

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

    function renderQueueItem(song, isNowPlaying) {
        const playing = isNowPlaying ? ' is-playing' : '';
        const bars = isNowPlaying ? seguro('<div class="pq-playing-bars"><span></span><span></span><span></span></div>') : '';
        return html`<div class="pq-item${playing}" data-src="${song.src || ''}">
            <img class="pq-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
            <div class="pq-item-info">
                <div class="pq-item-title">${song.title || 'Sin título'}</div>
                <div class="pq-item-artist">${song.channel || song.artist || 'Desconocido'}</div>
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
                    <img class="pq-item-thumb" src="${s.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                    <div class="pq-item-info">
                        <div class="pq-item-title">${s.title || 'Sin título'}</div>
                        <div class="pq-item-artist">${s.channel || s.artist || 'Desconocido'}</div>
                    </div>
                    <button class="pq-item-remove" data-next-remove="${i}" title="Quitar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
            }).join('');
            animateListChange(pqNextList, '.pq-item', el => el.dataset.src, antesSiguientes);
            // Bind remove buttons for next queue
            pqNextList.querySelectorAll('[data-next-remove]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = Number.parseInt(btn.dataset.nextRemove, 10);
                    siguientes().splice(idx, 1);
                    renderQueuePanel();
                });
            });
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
            pqQueueList.innerHTML = upcoming.map(s => renderQueueItem(s, false)).join('');
            animateListChange(pqQueueList, '.pq-item', el => el.dataset.src, antes);
            // Bind click-to-play on queue items
            pqQueueList.querySelectorAll('.pq-item').forEach((el, i) => {
                el.addEventListener('click', () => {
                    const realIdx = (indice() + i + 1) % q.length;
                    play(q[realIdx]);
                    fijarIndice(realIdx);
                    renderQueuePanel();
                });
            });
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
