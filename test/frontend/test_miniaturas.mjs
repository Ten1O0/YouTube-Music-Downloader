/**
 * Miniaturas fuera de la canción (plan 19, T2): la migración de los base64 de
 * la APK a ficheros, con un almacén y un sistema de ficheros simulados.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BANDERA, BANDERA_PEQUENAS, claveDe, esIncrustada, extensionDe, LADO_MINIATURA, medidasMiniatura, miniaturaDeFavorito,
    migrarMiniaturas, reducirMiniaturas, rutaPequena,
} from '../../frontend/src/core/miniaturas.js';
import { leer } from './fuentes.mjs';

const B64 = (n) => `data:image/jpeg;base64,${String(n).repeat(200)}`;

function almacen(datos) {
    const mem = structuredClone(datos);
    return {
        mem,
        get: async (k) => structuredClone(mem[k]),
        set: async (k, v) => { mem[k] = structuredClone(v); },
    };
}

/** Un «sistema de ficheros» que apunta lo que escribe y puede fallar en una clave. */
function ficheros({ falla = null } = {}) {
    const escritos = [];
    const guardar = async (clave, datos) => {
        if (clave === falla) throw new Error('disco lleno');
        escritos.push({ clave, datos });
        return { thumbnail: `https://localhost/_capacitor_file_/miniaturas/${clave}.jpg`, localThumbnailPath: `miniaturas/${clave}.jpg` };
    };
    return { escritos, guardar };
}

const cancion = (id, thumbnail) => ({ src: `file://${id}`, videoId: id, title: id, thumbnail });

test('los base64 de la biblioteca y de las listas pasan a fichero; los enlaces no se tocan', async () => {
    const a = cancion('aaaaaaaaaaa', B64(1));
    const b = cancion('bbbbbbbbbbb', 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg');
    const alm = almacen({
        ytdl_library: [a, b],
        ytdl_playlists: [{ id: '1', name: 'L', songs: [{ ...a }] }],
    });
    const fs = ficheros();
    const r = await migrarMiniaturas(alm, fs.guardar);
    assert.deepEqual(r, { hechas: 1, fallos: 0 });
    // Un solo fichero: la copia de la lista comparte el de la biblioteca
    assert.equal(fs.escritos.length, 1);
    assert.equal(fs.escritos[0].clave, 'aaaaaaaaaaa');
    const [na, nb] = alm.mem.ytdl_library;
    assert.equal(na.localThumbnailPath, 'miniaturas/aaaaaaaaaaa.jpg');
    assert.ok(!esIncrustada(na.thumbnail));
    assert.deepEqual(nb, b);
    assert.equal(alm.mem.ytdl_playlists[0].songs[0].localThumbnailPath, 'miniaturas/aaaaaaaaaaa.jpg');
    assert.ok(alm.mem[BANDERA]);
});

test('si un fichero falla, esa canción conserva su base64 y la migración se repite otro día', async () => {
    const alm = almacen({ ytdl_library: [cancion('aaaaaaaaaaa', B64(1)), cancion('ccccccccccc', B64(2))] });
    const r = await migrarMiniaturas(alm, ficheros({ falla: 'ccccccccccc' }).guardar);
    assert.deepEqual(r, { hechas: 1, fallos: 1 });
    assert.ok(!esIncrustada(alm.mem.ytdl_library[0].thumbnail));
    assert.equal(alm.mem.ytdl_library[1].thumbnail, B64(2)); // nada perdido
    assert.equal(alm.mem[BANDERA], undefined);                // se reintentará

    // Al día siguiente, con el disco bien, termina
    const r2 = await migrarMiniaturas(alm, ficheros().guardar);
    assert.deepEqual(r2, { hechas: 1, fallos: 0 });
    assert.ok(alm.mem.ytdl_library.every((s) => !esIncrustada(s.thumbnail)));
    assert.ok(alm.mem[BANDERA]);
});

test('dos canciones con la misma imagen tienen cada una su fichero (borrar una no deja sin miniatura a la otra)', async () => {
    const alm = almacen({ ytdl_library: [cancion('aaaaaaaaaaa', B64(1)), cancion('ccccccccccc', B64(1))] });
    const fs = ficheros();
    await migrarMiniaturas(alm, fs.guardar);
    assert.deepEqual(fs.escritos.map((e) => e.clave), ['aaaaaaaaaaa', 'ccccccccccc']);
    assert.notEqual(alm.mem.ytdl_library[0].localThumbnailPath, alm.mem.ytdl_library[1].localThumbnailPath);
});

test('hecha una vez, no vuelve a hacer nada', async () => {
    const alm = almacen({ ytdl_library: [cancion('aaaaaaaaaaa', B64(1))], [BANDERA]: 'ya' });
    const fs = ficheros();
    assert.deepEqual(await migrarMiniaturas(alm, fs.guardar), { hechas: 0, fallos: 0 });
    assert.equal(fs.escritos.length, 0);
});

test('no pisa lo que cambie mientras escribe los ficheros', async () => {
    const alm = almacen({ ytdl_library: [cancion('aaaaaaaaaaa', B64(1))] });
    const fs = ficheros();
    const guardarLento = async (clave, datos) => {
        // Mientras tanto, termina una descarga
        alm.mem.ytdl_library = [cancion('nuevanueva1', 'https://i.ytimg.com/x.jpg'), ...alm.mem.ytdl_library];
        return fs.guardar(clave, datos);
    };
    await migrarMiniaturas(alm, guardarLento);
    assert.deepEqual(alm.mem.ytdl_library.map((s) => s.videoId), ['nuevanueva1', 'aaaaaaaaaaa']);
    assert.ok(!esIncrustada(alm.mem.ytdl_library[1].thumbnail));
});

test('los favoritos con base64 pasan al enlace de YouTube', async () => {
    const alm = almacen({ favorites: [{ id: 'aaaaaaaaaaa', title: 'T', thumbnail: B64(1) }] });
    await migrarMiniaturas(alm, ficheros().guardar);
    assert.equal(alm.mem.favorites[0].thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
});

test('miniaturaDeFavorito: nunca un base64 ni un fichero del móvil', () => {
    assert.equal(miniaturaDeFavorito(B64(1), 'aaaaaaaaaaa'), 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
    assert.equal(miniaturaDeFavorito('http://localhost/_capacitor_file_/x.jpg', 'aaaaaaaaaaa'), 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
    assert.equal(miniaturaDeFavorito('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', 'aaaaaaaaaaa'), 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
    assert.equal(miniaturaDeFavorito(B64(1), 'no-vale'), '');
});

test('claves y extensiones de los ficheros', () => {
    assert.equal(claveDe({ videoId: 'aaaaaaaaaaa' }), 'aaaaaaaaaaa');
    assert.equal(claveDe({ videoId: 'aaaaaaaaaaa' }, 'f3c9'), 'aaaaaaaaaaa_f3c9');
    assert.match(claveDe({ src: 'file://x' }), /^s[0-9a-z]+$/);
    assert.equal(claveDe({ src: 'file://x' }), claveDe({ src: 'file://x' }));
    assert.equal(extensionDe('data:image/png;base64,xx'), 'png');
    assert.equal(extensionDe('data:image/jpeg;base64,xx'), 'jpg');
    assert.equal(extensionDe('data:image/webp;base64,xx'), 'webp');
    assert.equal(extensionDe('raro'), 'jpg');
});

test('el reproductor encuentra la miniatura en fichero (DATA/miniaturas), también de una canción descargada', async () => {
    const pedidas = [];
    globalThis.Capacitor = {
        platform: 'android',
        convertFileSrc: (uri) => uri.replace('file://', 'https://localhost/_capacitor_file_'),
        Plugins: {
            Filesystem: {
                getUri: async ({ path, directory }) => { pedidas.push(directory); return { uri: `file:///${directory}/${path}` }; },
            },
        },
    };
    // audio-url-cache.js escucha 'beforeunload' al cargarse
    const sinVentana = typeof globalThis.addEventListener !== 'function';
    if (sinVentana) globalThis.addEventListener = () => {};
    try {
        const { resolveNativeThumbnail } = await import('../../frontend/src/core/audio-store.js');
        const descargada = { ...cancion('aaaaaaaaaaa', 'x'), localPath: 'Music/a.m4a', localThumbnailPath: 'miniaturas/aaaaaaaaaaa.jpg' };
        const { finalThumb, runtimeThumbnailNative } = await resolveNativeThumbnail(descargada);
        // Antes se buscaba en DOCUMENTS: una dirección muerta y el icono de la app en el mini reproductor
        assert.deepEqual(pedidas, ['DATA']);
        assert.equal(runtimeThumbnailNative, 'file:///DATA/miniaturas/aaaaaaaaaaa.jpg');
        assert.equal(finalThumb, 'https://localhost/_capacitor_file_/DATA/miniaturas/aaaaaaaaaaa.jpg');
    } finally {
        delete globalThis.Capacitor;
        if (sinVentana) delete globalThis.addEventListener;
    }
});

// ── Dos tamaños (tras la 2.1.1): la Biblioteca iba a tirones descomprimiendo
//    carátulas de 1280-1400 px para pintarlas en 40 px ──

test('una carátula grande da una miniatura con el lado corto de LADO_MINIATURA, sin deformarla', () => {
    assert.deepEqual(medidasMiniatura(1280, 720), { ancho: 427, alto: LADO_MINIATURA });
    assert.deepEqual(medidasMiniatura(1400, 1400), { ancho: LADO_MINIATURA, alto: LADO_MINIATURA });
    assert.deepEqual(medidasMiniatura(600, 3000), { ancho: LADO_MINIATURA, alto: 1200 });
});

test('una imagen ya pequeña se usa tal cual: la mqdefault de YouTube, una cuadrada de 300 o una rota', () => {
    assert.equal(medidasMiniatura(320, 180), null);
    assert.equal(medidasMiniatura(300, 300), null);
    assert.equal(medidasMiniatura(0, 0), null);
    assert.equal(medidasMiniatura(undefined, 500), null);
});

test('la miniatura pequeña va al lado de la grande, en JPEG', () => {
    assert.equal(rutaPequena('miniaturas/abc_123.png'), 'miniaturas/abc_123_m.jpg');
    assert.equal(rutaPequena('miniaturas/s1x.jpg'), 'miniaturas/s1x_m.jpg');
});

/** Lo de la migración: la biblioteca y las listas en memoria y un «reducir» que apunta lo que hace. */
function escena({ biblioteca, listas = [], falla = null, pequena = (ruta) => ruta !== 'miniaturas/ya-pequena.jpg' }) {
    const alm = almacen({});
    const estado = { biblioteca: structuredClone(biblioteca), listas: structuredClone(listas), reducidas: [], turnos: 0, guardadas: 0 };
    return {
        alm, estado,
        deps: {
            almacen: alm,
            getLibrary: async () => structuredClone(estado.biblioteca),
            saveLibrary: async (b) => { estado.biblioteca = structuredClone(b); estado.guardadas++; },
            leerListas: async () => structuredClone(estado.listas),
            guardarListas: async (l) => { estado.listas = structuredClone(l); },
            turno: async () => { estado.turnos++; },
            reducir: async ({ localThumbnailPath: ruta }) => {
                if (ruta === falla) throw new Error('sin espacio');
                estado.reducidas.push(ruta);
                return pequena(ruta) ? { thumbnail: `url:${rutaPequena(ruta)}`, localThumbnailPath: rutaPequena(ruta), caratula: `url:${ruta}`, localCaratulaPath: ruta } : null;
            },
        },
    };
}
const local = (n, extra = {}) => ({ src: `file://${n}`, title: n, thumbnail: `url:miniaturas/${n}.png`, localThumbnailPath: `miniaturas/${n}.png`, ...extra });

test('la migración da miniatura pequeña a cada carátula grande, en la biblioteca y en sus copias de las listas', async () => {
    const a = local('a'); const b = local('b');
    const yt = { src: 'file://yt', title: 'yt', thumbnail: 'https://i.ytimg.com/vi/x/mqdefault.jpg' };
    const { deps, estado, alm } = escena({ biblioteca: [a, b, yt], listas: [{ id: 'l1', songs: [b, yt] }] });
    assert.deepEqual(await reducirMiniaturas(deps), { hechas: 2, fallos: 0 });
    const [na, nb, nyt] = estado.biblioteca;
    assert.equal(na.localThumbnailPath, 'miniaturas/a_m.jpg');
    assert.equal(na.localCaratulaPath, 'miniaturas/a.png');
    assert.equal(nb.caratula, 'url:miniaturas/b.png');
    assert.deepEqual(nyt, yt, 'lo de YouTube no se toca');
    assert.deepEqual(estado.listas[0].songs[0], nb, 'la copia en la lista, igual que la de la biblioteca');
    assert.equal(estado.turnos, 2, 'una por turno: no estorba al scroll');
    assert.equal(estado.guardadas, 1, 'con pocas, la biblioteca se guarda una sola vez, al final');
    assert.ok(await alm.get(BANDERA_PEQUENAS));
});

test('una vez hecha no se repite, y lo que ya tiene las dos medidas no se vuelve a reducir', async () => {
    const hecha = local('h', { localThumbnailPath: 'miniaturas/h_m.jpg', localCaratulaPath: 'miniaturas/h.png' });
    const { deps, estado } = escena({ biblioteca: [hecha, local('a')] });
    await reducirMiniaturas(deps);
    assert.deepEqual(estado.reducidas, ['miniaturas/a.png']);
    estado.reducidas = [];
    assert.deepEqual(await reducirMiniaturas(deps), { hechas: 0, fallos: 0 });
    assert.deepEqual(estado.reducidas, []);
});

test('si una falla, las demás se guardan y la migración se repite en el próximo arranque', async () => {
    const { deps, estado, alm } = escena({ biblioteca: [local('a'), local('b')], falla: 'miniaturas/a.png' });
    assert.deepEqual(await reducirMiniaturas(deps), { hechas: 1, fallos: 1 });
    assert.equal(estado.biblioteca[0].localCaratulaPath, undefined);
    assert.equal(estado.biblioteca[1].localCaratulaPath, 'miniaturas/b.png');
    assert.equal(await alm.get(BANDERA_PEQUENAS), undefined);
});

test('una carátula que ya era pequeña se queda como estaba y no cuenta como fallo', async () => {
    const pequena = local('ya-pequena', { thumbnail: 'url:miniaturas/ya-pequena.jpg', localThumbnailPath: 'miniaturas/ya-pequena.jpg' });
    const { deps, estado, alm } = escena({ biblioteca: [pequena] });
    assert.deepEqual(await reducirMiniaturas(deps), { hechas: 0, fallos: 0 });
    assert.deepEqual(estado.biblioteca, [pequena]);
    assert.ok(await alm.get(BANDERA_PEQUENAS));
});

test('el reproductor y la portada de la lista usan la carátula grande; al borrar, se van las dos', () => {
    assert.match(leer('frontend/src/core/audio-store.js'), /song\.localCaratulaPath \|\| song\.localThumbnailPath/);
    assert.match(leer('frontend/src/features/playlists/portada.js'), /\(grande && cancion\.caratula\) \|\| cancion\.thumbnail/);
    // La rejilla, la miniatura: la grande se descomprimiría entera por cada tarjeta
    assert.match(leer('frontend/src/features/playlists/playlists.js'), /caratulaElegida\(pl, \{ grande: false \}\)/);
    assert.match(leer('frontend/src/core/miniaturas.js'), /\[song\?\.localThumbnailPath, song\?\.localCaratulaPath\]/);
    assert.match(leer('frontend/src/features/download/download.js'), /localCaratulaPath: miniatura\.localCaratulaPath/);
});

test('con muchas, se guarda cada 10: si se cierra la app a medias, lo hecho no se repite', async () => {
    const biblioteca = Array.from({ length: 25 }, (_, i) => local(`c${i}`));
    const { deps, estado } = escena({ biblioteca });
    assert.deepEqual(await reducirMiniaturas(deps), { hechas: 25, fallos: 0 });
    assert.equal(estado.guardadas, 3);
    assert.ok(estado.biblioteca.every((s) => s.localCaratulaPath));
});
