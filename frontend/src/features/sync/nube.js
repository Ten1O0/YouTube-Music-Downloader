/**
 * Canciones en la nube (plan 13, T6): están en la cuenta pero su audio no está
 * en este dispositivo. Tocarla la descarga y la reproduce; «Descargar las que
 * faltan» las baja todas, de una en una. Nada se descarga solo: en un móvil
 * con datos, 300 canciones por sorpresa serían un problema.
 */

import { i18n } from '../../i18n/language-manager.js';
import { avisarSistema, avisoDeLote } from '../../native/notifications.js';
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

/**
 * Baja un lote de canciones de la nube, de una en una. Si ya hay un lote en
 * marcha, las nuevas se suman a él (las listas seguidas traen lo nuevo así).
 * @param {object[]} canciones
 * @param {{ alAvanzar?: (i: number, n: number) => void }} [o]
 * @returns {Promise<{ hechas: number, fallidas: number }>}
 */
export async function descargarVarias(canciones, { alAvanzar } = {}) {
    if (lote) {
        const ya = new Set(lote.cola.map((s) => s.videoId));
        lote.cola.push(...canciones.filter((s) => !ya.has(s.videoId)));
        return lote.resultado;
    }
    lote = { parar: false, cola: [...canciones], hechas: 0, fallidas: 0 };
    lote.resultado = (async () => {
        try {
            for (let i = 0; i < lote.cola.length; i++) {
                if (lote.parar) break;
                const song = lote.cola[i];
                // Puede haberse descargado (o borrado) mientras esperaba su turno
                const actual = (await LibraryModule.getLibrary()).find((s) => s.videoId === song.videoId);
                if (!actual || !esNube(actual)) continue;
                alAvanzar?.(i + 1, lote.cola.length);
                let hecha = await descargarDeLaNube(actual, { reproducir: false, enSegundoPlano: true });
                if (!hecha && !lote.parar) {
                    await esperar(ESPERA_TRAS_FALLO, () => lote.parar);
                    hecha = await descargarDeLaNube(actual, { reproducir: false, enSegundoPlano: true });
                }
                if (hecha) lote.hechas++; else lote.fallidas++;
                if (i < lote.cola.length - 1) await esperar(PAUSA_LOTE, () => lote.parar);
            }
            // Si la app no está a la vista, aviso del sistema al acabar (plan 14, T5)
            const aviso = avisoDeLote({ total: lote.hechas + lote.fallidas, fallidas: lote.fallidas }, (clave, p) => i18n.t(clave, p));
            if (aviso) avisarSistema(aviso);
            return { hechas: lote.hechas, fallidas: lote.fallidas };
        } finally {
            lote = null;
            await pintarBarra();
        }
    })();
    return lote.resultado;
}

async function descargarLasQueFaltan(boton) {
    if (lote) { lote.parar = true; return; }
    const faltan = (await LibraryModule.getLibrary()).filter(esNube);
    if (!faltan.length) return;
    await descargarVarias(faltan, {
        alAvanzar: (i, n) => { boton.textContent = i18n.t('cloud_downloading', { i, n }); },
    });
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
