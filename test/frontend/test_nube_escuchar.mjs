/**
 * Escuchar desde la nube (plan 29, T0-T3).
 *
 * Las canciones que no están descargadas suenan como la radio: se preparan en
 * su caché temporal unas pocas por delante, en el orden de la cola (en
 * aleatorio, primero las descargadas). Y una lista con canciones sin descargar
 * no las pierde al sincronizar con la cuenta.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarRemotos, listaACuenta } from '../../frontend/src/features/sync/fusion.js';
import { prepararPorDelante, suenaDesdeLaNube } from '../../frontend/src/features/nube/modelo.js';
import { app } from './harness.mjs';
import { leer } from './fuentes.mjs';

const { api } = app();
const nube = (id) => ({ src: `nube://${id}`, videoId: id, title: `Nube ${id}`, nube: true });
const local = (id) => ({ src: `idb://${id}`, videoId: id, title: `Local ${id}` });

describe('T0 · una lista con canciones sin descargar, al sincronizar', () => {
    const descargada = { src: 'idb://a', videoId: 'aaaaaaaaaaa', title: 'Descargada', addedAt: '2026-10-01T00:00:00.000Z' };
    const enNube = { videoId: 'bbbbbbbbbbb', title: 'Importada sin descargar', src: 'nube://bbbbbbbbbbb', nube: true };
    const lista = { id: '1790000000001', name: 'Importada', songs: [descargada, enNube], createdAt: '2026-10-01T00:00:00.000Z' };

    test('se queda con sus copias de las que no están en la biblioteca, en su sitio', () => {
        const remotos = { biblioteca: [{ videoId: 'aaaaaaaaaaa', title: 'Descargada', addedAt: '2026-10-01T00:00:00.000Z' }], listas: [listaACuenta(lista)] };
        const { listas } = aplicarRemotos({ biblioteca: [descargada], listas: [lista] }, remotos);
        assert.deepEqual(listas[0].songs.map((s) => s.title), ['Descargada', 'Importada sin descargar'], 'antes se perdía la importada');
        assert.equal(listas[0].songs[1].nube, true);
    });

    test('en otro dispositivo, sin copia propia, no se inventa nada', () => {
        const remotos = { biblioteca: [], listas: [listaACuenta(lista)] };
        const { listas } = aplicarRemotos({ biblioteca: [], listas: [] }, remotos);
        assert.deepEqual(listas[0].songs, []);
    });
});

describe('el contrato con la otra mitad del plan', () => {
    test('suena desde la nube lo que no está descargado: de la nube, de la radio o preparada', () => {
        assert.equal(suenaDesdeLaNube({ src: 'nube://x', nube: true }), true);
        assert.equal(suenaDesdeLaNube({ src: 'idb://radio:x', radio: true }), true);
        assert.equal(suenaDesdeLaNube({ src: 'idb://radio:x', desdeNube: true }), true);
        assert.equal(suenaDesdeLaNube({ src: 'idb://x' }), false);
        assert.equal(suenaDesdeLaNube(null), false);
    });
});

describe('T1 · qué se prepara por delante', () => {
    const cola = [local('l1'), local('l2'), nube('n1'), nube('n2'), nube('n3'), nube('n4'), local('l3')];

    test('solo las de la nube de las 3 posiciones siguientes, no más allá', () => {
        assert.deepEqual(prepararPorDelante(cola, 0, { cuantas: 3 }).map((s) => s.videoId), ['n1', 'n2'], 'l2, n1 y n2');
        assert.deepEqual(prepararPorDelante(cola, 1, { cuantas: 3 }).map((s) => s.videoId), ['n1', 'n2', 'n3']);
        assert.deepEqual(prepararPorDelante(cola, 4, { cuantas: 3 }).map((s) => s.videoId), ['n4']);
    });

    test('al final de la cola, nada; con «repetir todo», da la vuelta sin volver a la que suena', () => {
        assert.deepEqual(prepararPorDelante(cola, 6, { cuantas: 3 }), []);
        const corta = [nube('n1'), local('l1'), nube('n2')];
        assert.deepEqual(prepararPorDelante(corta, 2, { cuantas: 3, repetir: true }).map((s) => s.videoId), ['n1']);
        assert.deepEqual(prepararPorDelante([nube('n1')], 0, { cuantas: 3, repetir: true }), [], 'la que suena no se prepara otra vez');
    });

    test('la preparada conserva lo de la cuenta y suena con el audio de la caché', () => {
        const deLaNube = { ...nube('aaaaaaaaaaa'), artist: 'Luna Costa', track: 'Mar', editado: true, portada: 'gen:2', duration: 0 };
        const enLaCache = { src: 'idb://radio:aaaaaaaaaaa', localPath: 'radio/aaaaaaaaaaa.m4a', loudness: { lufs: -9 }, duration: 201, radio: true };
        const lista = api.cancionPreparada(deLaNube, enLaCache);
        assert.equal(lista.src, 'idb://radio:aaaaaaaaaaa');
        assert.equal(lista.desdeNube, true);
        assert.equal('nube' in lista, false);
        assert.equal(lista.radio, undefined, 'no es de la radio: no salen sus botones');
        assert.deepEqual([lista.artist, lista.track, lista.portada, lista.duration], ['Luna Costa', 'Mar', 'gen:2', 201]);
        assert.equal(lista.localPath, 'radio/aaaaaaaaaaa.m4a');
        assert.ok(suenaDesdeLaNube(lista));
    });

    test('nunca más de 3 por delante', () => {
        assert.equal(api.POR_DELANTE, 3);
    });
});

describe('T1 y T2 · el reproductor', () => {
    const PLAYER = leer('frontend/src/features/player/player.js');

    test('las de la nube ya no salen de la cola ni piden su descarga al pulsarlas', () => {
        assert.doesNotMatch(PLAYER, /queueList\.filter\(s => !s\?\.nube\)/);
        assert.doesNotMatch(PLAYER, /alPedirNube/);
        assert.doesNotMatch(leer('frontend/src/features/sync/nube.js'), /configurarNube/);
    });

    test('al tocarle a una de la nube (o a una preparada que la caché soltó), se prepara antes de sonar', () => {
        assert.match(PLAYER, /if \(\(song\.nube \|\| song\.desdeNube\) && !\(song = await desdeLaNube\(song\)\)\) return;\s*const finalSrc = await resolveStreamSrc\(song\);/);
    });

    test('con cada canción, se preparan las siguientes de la nube', () => {
        assert.match(PLAYER, /revisarNube\(getCurrentQueue\(\), currentIndex, repeatMode === 1\);/);
    });

    test('aleatorio: primero las descargadas y después las de la nube, cada grupo barajado', () => {
        const cola = [nube('n1'), local('l1'), nube('n2'), local('l2'), local('l3'), nube('n3')];
        for (let i = 0; i < 20; i++) {
            const b = api.barajar(cola);
            assert.equal(b.length, 6);
            assert.equal(b.slice(0, 3).map((s) => s.videoId).sort().join(), 'l1,l2,l3');
            assert.equal(b.slice(3).map((s) => s.videoId).sort().join(), 'n1,n2,n3');
        }
        const vistas = new Set(Array.from({ length: 50 }, () => api.barajar(cola).map((s) => s.videoId).join()));
        assert.ok(vistas.size > 1, 'sigue barajando');
    });

    test('la caché de la radio no suelta lo que protege cada uno (la radio y la nube)', () => {
        const CACHE = leer('frontend/src/features/radio/cache.js');
        assert.match(CACHE, /const protectores = new Set\(\);\s*export function protegerCon\(fn\) \{\s*protectores\.add\(fn\);/);
        assert.match(leer('frontend/src/features/nube/escuchar.js'), /protegerCon\(\(\) => protegidas\);/);
    });
});

describe('T3 · los textos, en los seis idiomas', () => {
    test('las mismas claves en todos, con su plural, y nunca «servidor» (se dice «la nube»)', async () => {
        const { TEXTOS_ESCUCHAR, textoEscuchar } = await import('../../frontend/src/features/nube/textos-escuchar.js');
        const claves = Object.keys(TEXTOS_ESCUCHAR.es).sort();
        assert.deepEqual(Object.keys(TEXTOS_ESCUCHAR).sort(), ['de', 'en', 'es', 'fr', 'pt', 'zh']);
        for (const [idioma, textos] of Object.entries(TEXTOS_ESCUCHAR)) {
            assert.deepEqual(Object.keys(textos).sort(), claves, idioma);
            assert.doesNotMatch(JSON.stringify(textos), /servidor|server|serveur|servidores/i, `${idioma} habla del servidor`);
        }
        assert.equal(textoEscuchar('enLaNube', 'es', 1), '1 canción suena desde la nube');
        assert.equal(textoEscuchar('enLaNube', 'es', 12), '12 canciones suenan desde la nube');
        assert.equal(textoEscuchar('primera', 'xx'), 'Preparando la primera canción…', 'sin el idioma, en castellano');
    });

    test('sus estilos van con el módulo (como texto) y no en el arranque', () => {
        const ESCUCHAR = leer('frontend/src/features/nube/escuchar.js');
        assert.match(ESCUCHAR, /import estilos from '\.\/escuchar\.css\?inline';/);
        assert.match(ESCUCHAR, /document\.head\?\.append\(/);
        assert.doesNotMatch(leer('frontend/src/styles.css'), /data-preparando-nube/);
    });
});
