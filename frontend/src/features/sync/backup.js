/**
 * Copia de seguridad (plan 13, T7): todo lo tuyo en un JSON legible, sin el
 * audio (por tamaño). Sirve para cambiar de dispositivo sin cuenta, o para
 * guardarlo aparte. Al restaurar, las canciones llegan «en la nube».
 *
 * Exportar: en la web, se descarga el fichero; en la APK, se guarda en
 * Documentos/YTMusic/copias/. Importar: se valida entero (validarCopia) y se
 * enseña un resumen antes de aplicar nada.
 */

import { isNative } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { i18n } from '../../i18n/language-manager.js';
import { entregarFichero } from '../download/save.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { CLAVE_CONTADORES, claveEscucha, sumarEscucha } from '../player/listens.js';
import { PlayerModule } from '../player/player.js';
import { ajustesReproduccion, cambiarAjustes } from '../player/settings.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { cancionACuenta, fusionarCopia, listaACuenta } from './fusion.js';
import { LIMITES } from './limites.js';
import { esVideoId, FORMATO_COPIA, miniaturaDe, parseSeguro, validarCopia } from './validar.js';

/** Lo tuyo, con la forma del fichero de copia (§2.6). */
export async function crearCopia() {
    const [biblioteca, listas, favoritos] = await Promise.all([LibraryModule.getLibrary(), getPlaylists(), FavoritesModule.getFavorites()]);
    let escuchas = [];
    try { escuchas = (await StorageModule.leerEscuchas()) || []; } catch { /* sin registro */ }
    return {
        formato: FORMATO_COPIA,
        version: 1,
        creada: new Date().toISOString(),
        app: isNative() ? 'apk' : 'web',
        biblioteca: biblioteca.map(cancionACuenta).filter(Boolean),
        listas: listas.map(listaACuenta).filter(Boolean),
        favoritos: favoritos.map((f) => f.videoId || f.id).filter(esVideoId),
        escuchas: escuchas.filter((e) => esVideoId(e.videoId))
            .map((e) => ({ videoId: e.videoId, artista: e.artista ?? '', cancion: e.cancion ?? '', t: e.t, s: e.segundos ?? 0 })),
        ajustes: { idioma: i18n.currentLang, reproduccion: { ...ajustesReproduccion() } },
    };
}

const nombreFichero = () => `music-downloader-copia-${new Date().toISOString().slice(0, 10)}.json`;

/** Exporta la copia. Devuelve dónde quedó (para avisar) o null si falló. */
export async function exportarCopia() {
    const texto = JSON.stringify(await crearCopia(), null, 1);
    const nombre = nombreFichero();
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (isNative() && fs) {
        const ruta = `YTMusic/copias/${nombre}`;
        await fs.writeFile({ path: ruta, data: texto, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
        return `Documentos/${ruta}`;
    }
    entregarFichero(new Blob([texto], { type: 'application/json' }), nombre);
    return nombre;
}

/** Lee y valida un fichero de copia. Lanza un Error con el texto para el usuario si no vale. */
export async function leerCopia(fichero) {
    if (!fichero) throw new Error(i18n.t('backup_invalid'));
    if (fichero.size > LIMITES.bytesCopia) throw new Error(i18n.t('backup_too_big'));
    let copia = null;
    try { copia = validarCopia(parseSeguro(await fichero.text())); } catch { copia = null; }
    if (!copia) throw new Error(i18n.t('backup_invalid'));
    return copia;
}

/** Escuchas de la copia que aún no están aquí, con sus contadores. */
async function importarEscuchas(escuchas) {
    let existentes = [];
    try { existentes = (await StorageModule.leerEscuchas()) || []; } catch { return 0; }
    const ya = new Set(existentes.map((e) => `${e.videoId}|${e.t}`));
    let contadores = (await StorageModule.get(CLAVE_CONTADORES)) || {};
    let nuevas = 0;
    for (const e of escuchas) {
        if (ya.has(`${e.videoId}|${e.t}`)) continue;
        await StorageModule.anotarEscucha({ clave: e.videoId, videoId: e.videoId, artista: e.artista, cancion: e.cancion, t: e.t, segundos: e.s });
        contadores = sumarEscucha(contadores, claveEscucha({ videoId: e.videoId }), e.s, new Date(e.t).toISOString());
        nuevas++;
    }
    if (nuevas) await StorageModule.set(CLAVE_CONTADORES, contadores);
    return nuevas;
}

/**
 * Aplica una copia ya validada. «combinar» suma sin borrar; «sustituir» deja
 * exactamente lo de la copia. Con sesión, lo que cambia se sube a la cuenta
 * como cualquier otro cambio local.
 */
export async function aplicarCopia(copia, modo) {
    const sustituir = modo === 'sustituir';
    const local = { biblioteca: await LibraryModule.getLibrary(), listas: await getPlaylists() };
    const r = fusionarCopia(local, copia, sustituir ? 'sustituir' : 'combinar');

    for (const song of r.borradas) {
        await LibraryModule.liberarAudio(song);
        PlayerModule.removeSongFromQueue(song.src);
    }
    await LibraryModule.saveLibrary(r.biblioteca);
    await savePlaylists(r.listas);

    const porId = new Map(r.biblioteca.filter((s) => esVideoId(s.videoId)).map((s) => [s.videoId, s]));
    await FavoritesModule.importar(copia.favoritos.map((id) => {
        const s = porId.get(id);
        return { id, videoId: id, title: s?.title || 'Sin título', thumbnail: miniaturaDe(id), channel: s?.channel || '', url: `https://www.youtube.com/watch?v=${id}`, addedAt: new Date().toISOString() };
    }), { sustituir });

    await importarEscuchas(copia.escuchas);

    if (sustituir) {
        if (copia.ajustes.idioma && copia.ajustes.idioma !== i18n.currentLang) {
            await i18n.setLanguage(copia.ajustes.idioma);
            document.dispatchEvent(new CustomEvent('idioma-elegido'));
        }
        if (copia.ajustes.reproduccion && Object.keys(copia.ajustes.reproduccion).length) cambiarAjustes(copia.ajustes.reproduccion);
    }

    await LibraryModule.render();
    await LibraryModule.updateCount();
    await PlaylistModule.renderGrid();
    return r;
}
