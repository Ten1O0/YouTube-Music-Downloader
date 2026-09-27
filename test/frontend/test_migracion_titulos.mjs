/**
 * Artista y canción para lo que ya estaba en la biblioteca (plan 11, T3).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './harness.mjs';

/** El cliente con un almacén en memoria: el IndexedDB del arnés no responde. */
function conAlmacen() {
    const entorno = loadApp();
    const almacen = new Map();
    const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    entorno.api.StorageModule.get = async (k) => copia(almacen.get(k)) ?? null;
    entorno.api.StorageModule.set = async (k, v) => { almacen.set(k, copia(v)); };
    return entorno;
}

describe('migrarTitulos', () => {
    test('rellena biblioteca y listas, respeta lo editado y no repite', async () => {
        const { api } = conAlmacen();
        const S = api.StorageModule;
        await S.set('ytdl_library', [
            { src: 'idb://a', title: 'Rick Astley - Never Gonna Give You Up (Official Video)', channel: 'RickAstleyVEVO' },
            { src: 'idb://b', title: 'Algo', channel: 'Canal', artist: 'Yo', track: 'Mía', editado: true },
        ]);
        await S.set('ytdl_playlists', [{ id: '1', name: 'L', songs: [{ src: 'idb://a', title: 'Adele - Hello (Official Music Video)', channel: 'AdeleVEVO' }] }]);

        await api.migrarTitulos();

        const lib = plain(await S.get('ytdl_library'));
        assert.equal(lib[0].artist, 'Rick Astley');
        assert.equal(lib[0].track, 'Never Gonna Give You Up');
        assert.deepEqual(lib[1], { src: 'idb://b', title: 'Algo', channel: 'Canal', artist: 'Yo', track: 'Mía', editado: true });
        const pls = plain(await S.get('ytdl_playlists'));
        assert.equal(pls[0].songs[0].track, 'Hello');
        assert.ok(await S.get(api.TITLES_FLAG_KEY), 'queda marcada');

        // Una segunda vez no hace nada, aunque haya cambios después
        await S.set('ytdl_library', [{ src: 'idb://c', title: 'X - Y', channel: 'Z' }]);
        await api.migrarTitulos();
        assert.ok(!('artist' in plain(await S.get('ytdl_library'))[0]));
    });

    test('sin biblioteca ni listas no rompe', async () => {
        const { api } = conAlmacen();
        await api.migrarTitulos();
        assert.ok(await api.StorageModule.get(api.TITLES_FLAG_KEY));
    });
});
