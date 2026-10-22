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
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { avisar } from '../../ui/toast.js';
import { alCambiarRadio, esDeRadio, estadoRadio, guardarDeRadio, noMeGustaRadio } from '../radio/puente.js';
import { ajustesReproduccion, cambiarAjustes } from './settings.js';
import { syncRepeatButtonState } from './ui.js';
import { caratulaDe } from '../../core/portada-generada.js';

const ICONO_GUARDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICONO_VETAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>';

/** Guardar (si aún no está en la biblioteca) y No me gusta, en una canción de la radio (plan 16). */
function accionesDeRadio(song) {
    if (!esDeRadio(song)) return '';
    const guardarBtn = song.radio
        ? html`<button class="pq-item-accion" type="button" data-radio-guardar="${song.src}" title="${i18n.t('radio_save')}" aria-label="${i18n.t('radio_save')}">${seguro(ICONO_GUARDAR)}</button>`
        : '';
    return html`${seguro(guardarBtn)}<button class="pq-item-accion" type="button" data-radio-vetar="${song.src}" title="${i18n.t('radio_dislike')}" aria-label="${i18n.t('radio_dislike')}">${seguro(ICONO_VETAR)}</button>`;
}

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
    const pqRadioBtn = document.getElementById('pqRadioBtn');
    const pqRadioSection = document.getElementById('pqRadioSection');
    const pqRadioList = document.getElementById('pqRadioList');
    const pqRadioEstado = document.getElementById('pqRadioEstado');

    /** La radio: lo que está listo para sonar al acabar la cola y lo que se prepara. */
    function renderRadioSection() {
        const r = estadoRadio();
        if (pqRadioBtn) {
            pqRadioBtn.classList.toggle('active', r.activa);
            pqRadioBtn.setAttribute('aria-pressed', String(r.activa));
        }
        if (!pqRadioSection) return;
        pqRadioSection.hidden = !r.activa;
        if (!r.activa) return;
        if (pqRadioEstado) {
            pqRadioEstado.textContent = r.esperando || r.preparando
                ? i18n.t('radio_preparing_n', { n: r.preparando })
                : '';
        }
        pqRadioList.innerHTML = r.listas.length
            ? r.listas.map((s) => renderQueueItem(s, false)).join('')
            : html`<p class="pq-radio-ayuda">${i18n.t('radio_help')}</p>`;
    }

    function renderQueueItem(song, isNowPlaying, pos = -1) {
        const playing = isNowPlaying ? ' is-playing' : '';
        const bars = isNowPlaying ? seguro('<div class="pq-playing-bars"><span></span><span></span><span></span></div>') : '';
        return html`<div class="pq-item${playing}" data-src="${song.src || ''}" data-pos="${pos}">
            <img class="pq-item-thumb" src="${caratulaDe(song)}" alt="" width="32" height="32" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
            <div class="pq-item-info">
                <div class="pq-item-title">${nombreDe(song).titulo}</div>
                <div class="pq-item-artist">${nombreDe(song).artista || i18n.t('unknown_artist')}</div>
            </div>
            ${bars}
            ${seguro(accionesDeRadio(song))}
        </div>`;
    }

    function renderNextUpQueueSection(pqNextSection, pqNextList) {
        if (!pqNextSection || !pqNextList) return;
        if (siguientes().length > 0) {
            pqNextSection.style.display = '';
            const antesSiguientes = measure(pqNextList, '.pq-item', el => el.dataset.src);
            pqNextList.innerHTML = siguientes().map((s, i) => {
                return html`<div class="pq-item" data-next-index="${i}" data-src="${s.src || ''}">
                    <img class="pq-item-thumb" src="${caratulaDe(s)}" alt="" width="32" height="32" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
                    <div class="pq-item-info">
                        <div class="pq-item-title">${nombreDe(s).titulo}</div>
                        <div class="pq-item-artist">${nombreDe(s).artista || i18n.t('unknown_artist')}</div>
                    </div>
                    <button class="pq-item-remove" data-next-remove="${i}" title="${i18n.t('pq_remove')}">
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
        // Lo que viene después de la que suena. Solo con «repetir todo» da la
        // vuelta: sin él, lo escuchado ya no es «siguiente» y la cola se acaba
        const repetir = repeticion() === 1;
        const upcoming = [];
        for (let i = 1; i < q.length; i++) {
            const idx = indice() + i;
            if (idx >= q.length && !repetir) break;
            upcoming.push(q[idx % q.length]);
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
        renderRadioSection();

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
    // Guardar y No me gusta, en la que suena, en la cola y en la sección de la radio
    pqSheet?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-radio-guardar], [data-radio-vetar]');
        if (!btn) return;
        e.stopPropagation();
        const src = btn.dataset.radioGuardar ?? btn.dataset.radioVetar;
        const song = [...cola(), ...estadoRadio().listas].find((s) => s.src === src);
        if (!song) return;
        if (btn.dataset.radioGuardar !== undefined) guardarDeRadio(song);
        else noMeGustaRadio(song);
    }, true);
    pqRadioBtn?.addEventListener('click', () => {
        const activa = !ajustesReproduccion().radio;
        cambiarAjustes({ radio: activa });
        avisar(i18n.t(activa ? 'radio_on' : 'radio_off'));
    });
    alCambiarRadio(() => { if (!pqSheet?.classList.contains('hidden')) renderQueuePanel(); });

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
