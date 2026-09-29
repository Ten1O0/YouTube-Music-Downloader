/**
 * Canciones en la nube (plan 13, T6): están en la cuenta pero su audio no está
 * en este dispositivo. Tocarla la descarga y la reproduce; «Descargar las que
 * faltan» las baja todas en un lote (plan 20). Nada se descarga solo: en un
 * móvil con datos, 300 canciones por sorpresa serían un problema.
 */

import { i18n } from '../../i18n/language-manager.js';
import { showStatus } from '../../ui/status.js';
import { downloadFromUrl } from '../download/download.js';
import { cancelarLote, descargarLote } from '../download/lotes.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { esNube } from './fusion.js';

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

/** Las que llegan casi a la vez (varias listas seguidas en una comprobación) van en un solo lote. */
const JUNTAR_MS = 1500;
let enEspera = null;          // { canciones: Map(videoId → canción), alProgreso, promesa }
const enUnLote = new Set();   // videoId que ya van en un lote en marcha
const lotesEnMarcha = new Set();

/**
 * Baja varias canciones de la nube con un lote del servidor (plan 20): de 3 en
 * 3 y sin pausas, en vez de una a una. Las que llegan mientras se prepara el
 * lote se suman a él; las que ya van en uno, no se repiten.
 * @param {object[]} canciones
 * @param {{ alProgreso?: (estado) => void, inmediato?: boolean }} [o]
 * @returns {Promise<{ hechas: number, fallidas: number }>}
 */
export function descargarVarias(canciones, { alProgreso, inmediato = false } = {}) {
    enEspera ??= prepararLote(inmediato ? 0 : JUNTAR_MS);
    for (const s of canciones ?? []) {
        if (s?.videoId && !enUnLote.has(s.videoId)) enEspera.canciones.set(s.videoId, s);
    }
    if (alProgreso) enEspera.alProgreso = alProgreso;
    return enEspera.promesa;
}

function prepararLote(ms) {
    const espera = { canciones: new Map(), alProgreso: null };
    espera.promesa = new Promise((resolver) => {
        setTimeout(async () => {
            enEspera = null;
            // Las que ya no están en la nube (se bajaron mientras tanto) no se piden
            const biblioteca = await LibraryModule.getLibrary();
            const siguen = [...espera.canciones.values()]
                .filter((s) => biblioteca.some((x) => x.videoId === s.videoId && esNube(x)));
            siguen.forEach((s) => enUnLote.add(s.videoId));
            const ids = [];
            try {
                const r = siguen.length
                    ? await descargarLote(siguen, {
                        nombre: i18n.t('cloud_batch_name'),
                        alProgreso: espera.alProgreso,
                        alEmpezar: (id) => { ids.push(id); lotesEnMarcha.add(id); pintarBarra(); },
                    })
                    : { hechas: 0, fallidas: [] };
                resolver({ hechas: r.hechas, fallidas: r.fallidas.length });
            } catch (e) {
                console.warn('[Nube] Lote:', e);
                resolver({ hechas: 0, fallidas: siguen.length });
            } finally {
                siguen.forEach((s) => enUnLote.delete(s.videoId));
                ids.forEach((id) => lotesEnMarcha.delete(id));
                await pintarBarra();
            }
        }, ms);
    });
    return espera;
}

async function descargarLasQueFaltan(boton) {
    // Pulsarlo con un lote en marcha lo para
    if (lotesEnMarcha.size) {
        await Promise.all([...lotesEnMarcha].map((id) => cancelarLote(id)));
        return;
    }
    const faltan = (await LibraryModule.getLibrary()).filter(esNube);
    if (!faltan.length) return;
    boton.textContent = i18n.t('cloud_downloading', { i: 0, n: faltan.length });
    await descargarVarias(faltan, {
        inmediato: true,
        alProgreso: (e) => { boton.textContent = i18n.t('cloud_downloading', { i: e.hechas, n: e.total }); },
    });
}

/** La barra de arriba de la biblioteca: solo si hay canciones en la nube. */
export async function pintarBarra() {
    const barra = document.getElementById('libraryCloudBar');
    const boton = document.getElementById('libraryCloudBtn');
    if (!barra || !boton) return;
    const n = (await LibraryModule.getLibrary()).filter(esNube).length;
    barra.hidden = n === 0 && !lotesEnMarcha.size;
    if (!lotesEnMarcha.size) boton.textContent = i18n.t('cloud_download_all', { n });
}

export function initNube() {
    PlayerModule.configurarNube((song) => descargarDeLaNube(song));
    const boton = document.getElementById('libraryCloudBtn');
    boton?.addEventListener('click', () => descargarLasQueFaltan(boton));
    document.addEventListener('biblioteca-pintada', () => { pintarBarra(); });
}
