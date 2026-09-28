/**
 * Juntar lo local con la cuenta y con las copias (plan 13, T4): el audio que
 * ya está aquí no se pierde, lo nuevo llega en la nube y las lápidas borran.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    aplicarRemotos, cancionACuenta, descargadasPrimero, diferenciasBiblioteca, diferenciasListas, fusionarCopia, nombreLibre, PREFIJO_NUBE,
} from '../../frontend/src/features/sync/fusion.js';

const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const C = 'ccccccccccc';
const local = (videoId, extra = {}) => ({ videoId, src: `idb://${videoId}`, title: `T ${videoId}`, channel: 'Canal', artist: 'Art', track: `T ${videoId}`, addedAt: '2026-01-01T00:00:00.000Z', loudness: { lufs: -9 }, ...extra });
const remota = (videoId, extra = {}) => ({ videoId, title: `R ${videoId}`, channel: 'Canal', artist: 'Remoto', track: `R ${videoId}`, extra: '', editado: false, duration: 100, addedAt: '2026-02-01T00:00:00.000Z', ...extra });

describe('diferencias', () => {
    test('añadir, cambiar y quitar; lo que no viaja (src, loudness) no cuenta', () => {
        const antes = [local(A), local(B)];
        const despues = [local(A, { artist: 'Nuevo' }), local(C), { ...local(B), loudness: { lufs: -20 }, src: 'otro' }];
        const cambios = diferenciasBiblioteca(antes, despues);
        assert.deepEqual(cambios.map((c) => [c.accion, c.datos.videoId]), [['poner', A], ['poner', C]]);
        assert.deepEqual(diferenciasBiblioteca([local(A)], []).map((c) => [c.accion, c.datos.videoId]), [['borrar', A]]);
    });

    test('las canciones sin videoId (importadas del móvil) no viajan', () => {
        assert.equal(cancionACuenta({ src: 'idb://x', title: 'Importada' }), null);
        assert.deepEqual(diferenciasBiblioteca([], [{ src: 'idb://x', videoId: 'lib_12345' }]), []);
    });

    test('listas: nombre, orden y borrado', () => {
        const pl = { id: '17', name: 'Viaje', description: '', songs: [local(A), local(B)], createdAt: 'x' };
        assert.deepEqual(diferenciasListas([], [pl])[0].datos.songs, [A, B]);
        assert.deepEqual(diferenciasListas([pl], [{ ...pl, songs: [local(B), local(A)] }])[0].datos.songs, [B, A]);
        assert.deepEqual(diferenciasListas([pl], [pl]), []);
        assert.deepEqual(diferenciasListas([pl], []), [{ tipo: 'lista', accion: 'borrar', datos: { id: '17' } }]);
    });
});

describe('aplicarRemotos', () => {
    test('conserva el audio local y actualiza lo que viaja', () => {
        const { biblioteca } = aplicarRemotos({ biblioteca: [local(A)], listas: [] }, { biblioteca: [remota(A, { artist: 'Editado', editado: true })], listas: [] });
        assert.equal(biblioteca[0].src, `idb://${A}`);
        assert.deepEqual(biblioteca[0].loudness, { lufs: -9 });
        assert.equal(biblioteca[0].artist, 'Editado');
        assert.equal(biblioteca[0].editado, true);
    });

    test('lo que no está aquí llega en la nube, con miniatura rehecha desde el videoId', () => {
        const { biblioteca } = aplicarRemotos({ biblioteca: [], listas: [] }, { biblioteca: [remota(B)], listas: [] });
        assert.deepEqual([biblioteca[0].nube, biblioteca[0].src, biblioteca[0].thumbnail],
            [true, `${PREFIJO_NUBE}${B}`, `https://i.ytimg.com/vi/${B}/mqdefault.jpg`]);
    });

    test('una lápida borra la canción local y la devuelve para liberar su audio; también de las listas', () => {
        const pl = { id: '1', name: 'L', songs: [local(A), local(B)] };
        const r = aplicarRemotos({ biblioteca: [local(A), local(B)], listas: [pl] }, { biblioteca: [{ videoId: A, deleted: true }], listas: [] });
        assert.deepEqual(r.biblioteca.map((s) => s.videoId), [B]);
        assert.deepEqual(r.borradas.map((s) => s.src), [`idb://${A}`]);
        assert.deepEqual(r.listas[0].songs.map((s) => s.videoId), [B]);
    });

    test('lo que tiene un cambio local sin enviar no se pisa', () => {
        const r = aplicarRemotos({ biblioteca: [local(A, { artist: 'Mío' })], listas: [] },
            { biblioteca: [remota(A, { artist: 'Viejo' })], listas: [] }, { pendientes: new Set([`cancion:${A}`]) });
        assert.equal(r.biblioteca[0].artist, 'Mío');
    });

    test('una lista remota se arma con las canciones de la biblioteca, en su orden', () => {
        const r = aplicarRemotos({ biblioteca: [local(A)], listas: [] },
            { biblioteca: [remota(B)], listas: [{ id: 'x', name: 'Viaje', description: '', songs: [B, A, C], createdAt: 'c' }] });
        const [pl] = r.listas;
        assert.deepEqual(pl.songs.map((s) => [s.videoId, s.nube === true]), [[B, true], [A, false]], 'C no está en la biblioteca: se omite');
    });

    test('las canciones importadas de una lista local no se pierden al llegar la versión remota', () => {
        const importada = { src: 'idb://imp', title: 'Mía' };
        const r = aplicarRemotos({ biblioteca: [local(A)], listas: [{ id: 'x', name: 'L', songs: [importada, local(A)] }] },
            { biblioteca: [], listas: [{ id: 'x', name: 'L2', description: '', songs: [A], createdAt: 'c' }] });
        assert.deepEqual(r.listas[0].songs.map((s) => s.src), [`idb://${A}`, 'idb://imp']);
        assert.equal(r.listas[0].name, 'L2');
    });

    test('una lista con lápida desaparece', () => {
        const r = aplicarRemotos({ biblioteca: [], listas: [{ id: 'x', name: 'L', songs: [] }] }, { biblioteca: [], listas: [{ id: 'x', deleted: true }] });
        assert.deepEqual(r.listas, []);
    });

    test('las más nuevas primero', () => {
        const r = aplicarRemotos({ biblioteca: [local(A, { addedAt: '2026-01-01T00:00:00Z' })], listas: [] },
            { biblioteca: [remota(B, { addedAt: '2026-05-01T00:00:00Z' }), remota(C, { addedAt: '2025-01-01T00:00:00Z' })], listas: [] });
        assert.deepEqual(r.biblioteca.map((s) => s.videoId), [B, A, C]);
    });

    test('aplicar dos veces lo mismo no duplica', () => {
        const remotos = { biblioteca: [remota(B)], listas: [{ id: 'x', name: 'L', description: '', songs: [B], createdAt: 'c' }] };
        const una = aplicarRemotos({ biblioteca: [], listas: [] }, remotos);
        const dos = aplicarRemotos(una, remotos);
        assert.equal(dos.biblioteca.length, 1);
        assert.equal(dos.listas.length, 1);
        assert.equal(dos.listas[0].songs.length, 1);
    });
});

describe('fusionarCopia', () => {
    const copia = { biblioteca: [remota(A, { artist: 'DeCopia' }), remota(B)], listas: [{ id: 'l1', name: 'Viaje', description: '', songs: [A, B], createdAt: 'c' }] };

    test('combinar: suma sin borrar y sin tocar lo que ya está aquí', () => {
        const r = fusionarCopia({ biblioteca: [local(A), local(C)], listas: [] }, copia, 'combinar');
        assert.deepEqual(r.biblioteca.map((s) => s.videoId).sort(), [A, B, C]);
        assert.equal(r.biblioteca.find((s) => s.videoId === A).artist, 'Art', 'lo local se queda');
        assert.equal(r.biblioteca.find((s) => s.videoId === B).nube, true);
        assert.deepEqual(r.borradas, []);
    });

    test('combinar: una lista con otro id y el mismo nombre se renombra; con el mismo id, suma canciones', () => {
        const r = fusionarCopia({ biblioteca: [local(A)], listas: [{ id: 'otra', name: 'viaje', songs: [] }] }, copia, 'combinar');
        assert.deepEqual(r.listas.map((l) => l.name), ['viaje', 'Viaje (2)']);
        const mismaId = fusionarCopia({ biblioteca: [local(A)], listas: [{ id: 'l1', name: 'Mía', songs: [local(A)] }] }, copia, 'combinar');
        assert.deepEqual(mismaId.listas[0].songs.map((s) => s.videoId), [A, B]);
        assert.equal(mismaId.listas[0].name, 'Mía');
    });

    test('sustituir: queda lo de la copia; lo que ya estaba conserva su audio; lo demás se borra', () => {
        const r = fusionarCopia({ biblioteca: [local(A), local(C), { src: 'idb://imp', title: 'Importada' }], listas: [{ id: 'z', name: 'Z', songs: [] }] }, copia, 'sustituir');
        assert.deepEqual(r.biblioteca.map((s) => s.videoId).sort(), [A, B]);
        const a = r.biblioteca.find((s) => s.videoId === A);
        assert.deepEqual([a.src, a.artist], [`idb://${A}`, 'DeCopia']);
        assert.deepEqual(r.borradas.map((s) => s.src).sort(), [`idb://${C}`, 'idb://imp']);
        assert.deepEqual(r.listas.map((l) => l.id), ['l1']);
    });

    test('nombreLibre: sufijos y el límite de 40 caracteres', () => {
        assert.equal(nombreLibre('Viaje', ['viaje', 'Viaje (2)']), 'Viaje (3)');
        const largo = 'x'.repeat(40);
        assert.equal(nombreLibre(largo, [largo]).length, 40);
    });
});

describe('descargadasPrimero: la biblioteca enseña antes lo que suena aquí', () => {
    test('las descargadas delante, las de la nube detrás, cada grupo en su orden', () => {
        const lib = [
            { src: 'nube://1', nube: true, title: 'Nube 1' },
            { src: 'idb://a', title: 'Local A' },
            { src: 'nube://2', nube: true, title: 'Nube 2' },
            { src: 'idb://b', title: 'Local B' },
        ];
        assert.deepEqual(descargadasPrimero(lib).map((s) => s.title), ['Local A', 'Local B', 'Nube 1', 'Nube 2']);
        // No toca la biblioteca guardada
        assert.equal(lib[0].title, 'Nube 1');
    });

    test('sin canciones en la nube, el orden no cambia', () => {
        const lib = [{ src: 'a' }, { src: 'b' }];
        assert.deepEqual(descargadasPrimero(lib), lib);
        assert.deepEqual(descargadasPrimero([]), []);
    });
});
