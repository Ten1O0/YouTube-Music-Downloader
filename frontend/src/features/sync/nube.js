/**
 * Canciones en la nube (plan 13, T6): están en la cuenta pero su audio no está
 * en este dispositivo. Tocarla la descarga y la reproduce; «Descargar las que
 * faltan» las baja todas, de una en una. Nada se descarga solo: en un móvil
 * con datos, 300 canciones por sorpresa serían un problema.
 */

import { i18n } from '../../i18n/language-manager.js';
import { showStatus } from '../../ui/status.js';
import { downloadFromUrl } from '../download/download.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { esNube } from './fusion.js';

/** Entre descarga y descarga del lote: por debajo de las 10 por minuto del servidor. */
const PAUSA_LOTE = 7_000;
/** Si una falla (el límite por hora, la red), se espera antes de seguir. */
const ESPERA_TRAS_FALLO = 65_000;

const urlDe = (song) => `https://www.youtube.com/watch?v=${song.videoId}`;
const infoDe = (song) => ({ id: song.videoId, videoId: song.videoId, title: song.title, thumbnail: song.thumbnail, channel: song.channel });

/** Descarga una canción de la nube y, si se pide, la reproduce al terminar. */
export async function descargarDeLaNube(song, { reproducir = true, enSegundoPlano = false } = {}) {
    if (globalThis.navigator?.onLine === false) {
        showStatus(i18n.t('cloud_offline'), 'error');
        return null;
    }
    const nueva = await downloadFromUrl(urlDe(song), infoDe(song), enSegundoPlano ? {} : null);
    if (nueva && reproducir) {
        const biblioteca = (await LibraryModule.getLibrary()).filter((s) => !esNube(s));
        const i = biblioteca.findIndex((s) => s.src === nueva.src);
        PlayerModule.play(nueva, biblioteca, Math.max(0, i));
    }
    return nueva;
}

let lote = null;

async function descargarLasQueFaltan(boton) {
    if (lote) { lote.parar = true; return; }
    const faltan = (await LibraryModule.getLibrary()).filter(esNube);
    if (!faltan.length) return;
    lote = { parar: false };
    try {
        for (const [i, song] of faltan.entries()) {
            if (lote.parar) break;
            boton.textContent = i18n.t('cloud_downloading', { i: i + 1, n: faltan.length });
            let hecha = await descargarDeLaNube(song, { reproducir: false, enSegundoPlano: true });
            if (!hecha && !lote.parar) {
                await esperar(ESPERA_TRAS_FALLO, () => lote.parar);
                hecha = await descargarDeLaNube(song, { reproducir: false, enSegundoPlano: true });
            }
            if (i < faltan.length - 1) await esperar(PAUSA_LOTE, () => lote.parar);
        }
    } finally {
        lote = null;
        await pintarBarra();
    }
}

function esperar(ms, parar) {
    return new Promise((resolve) => {
        const inicio = Date.now();
        const tic = setInterval(() => {
            if (parar() || Date.now() - inicio >= ms) { clearInterval(tic); resolve(); }
        }, 250);
    });
}

/** La barra de arriba de la biblioteca: solo si hay canciones en la nube. */
export async function pintarBarra() {
    const barra = document.getElementById('libraryCloudBar');
    const boton = document.getElementById('libraryCloudBtn');
    if (!barra || !boton) return;
    const n = (await LibraryModule.getLibrary()).filter(esNube).length;
    barra.hidden = n === 0 && !lote;
    if (!lote) boton.textContent = i18n.t('cloud_download_all', { n });
}

export function initNube() {
    PlayerModule.configurarNube((song) => descargarDeLaNube(song));
    const boton = document.getElementById('libraryCloudBtn');
    boton?.addEventListener('click', () => descargarLasQueFaltan(boton));
    document.addEventListener('biblioteca-pintada', () => { pintarBarra(); });
}
