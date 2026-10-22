/**
 * Recuperar la carátula real de las canciones que no tienen (plan 27, T4): quién
 * está pendiente, dónde se pone y cómo se reconoce el vídeo de una canción en el
 * buscador sin adivinar (título exacto, artista y duración).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    coincide, datosParaCoincidir, idDeResultados, MARGEN_DURACION, pendientesDeCaratula, ponerCaratula, tieneCaratula,
} from '../../frontend/src/features/library/caratulas-modelo.js';
import { leer } from './fuentes.mjs';

const TURBIO = 'rLZSjJPyulk';
const TITULO = 'KAZE - MODO TURBIO - VIDEOCLIP [PROD. FIGU]';
const MINIATURA = `https://i.ytimg.com/vi/${TURBIO}/mqdefault.jpg`;

describe('quién está pendiente', () => {
    const sin = (extra = {}) => ({ src: 'idb://a', videoId: TURBIO, title: TITULO, thumbnail: '', ...extra });

    test('sin carátula, con su id de YouTube y sin intentar', () => {
        assert.deepEqual(pendientesDeCaratula([sin()]).map((s) => s.src), ['idb://a']);
    });

    test('se salta lo que ya tiene carátula, lo de la nube, lo que no tiene id y lo ya intentado', () => {
        const biblioteca = [
            sin({ src: 'idb://con', thumbnail: MINIATURA }),
            sin({ src: 'idb://grande', caratula: 'https://localhost/_capacitor_file_/x.png' }),
            sin({ src: 'nube', nube: true }),
            sin({ src: 'idb://lib', videoId: 'lib_8a8ceb9e0d4f' }),
            sin({ src: 'idb://intentada' }),
            sin({ src: 'idb://buena' }),
        ];
        assert.deepEqual(pendientesDeCaratula(biblioteca, { 'idb://intentada': 1 }).map((s) => s.src), ['idb://buena']);
    });

    test('la portada generada no es una carátula: no se guarda en la canción', () => {
        assert.equal(tieneCaratula({ thumbnail: '' }), false);
        assert.equal(tieneCaratula({ thumbnail: MINIATURA }), true);
    });
});

test('ponerCaratula: la biblioteca y las copias de las listas con ese src, sin pisar una que ya tenga', () => {
    const lista = [
        { src: 'idb://a', thumbnail: '' },
        { src: 'idb://a', thumbnail: 'https://otra' },
        { src: 'idb://b', thumbnail: '' },
    ];
    assert.equal(ponerCaratula(lista, 'idb://a', { thumbnail: MINIATURA, localThumbnailPath: 'miniaturas/x.jpg' }), 1);
    assert.deepEqual(lista.map((s) => s.thumbnail), [MINIATURA, 'https://otra', '']);
    assert.equal(lista[0].localThumbnailPath, 'miniaturas/x.jpg');
});

describe('lo que la canción sabe de sí misma', () => {
    test('el artista de las etiquetas del fichero, sin «- Topic» ni VEVO, y su duración', () => {
        assert.deepEqual(datosParaCoincidir({ channel: 'KAZE - Topic', duration: 204 }), { artista: 'kaze', segundos: 204 });
    });

    test('«Importado localmente» no es un artista; sin nada, no se comprueba', () => {
        assert.deepEqual(datosParaCoincidir({ channel: 'Importado localmente', artist: 'Importado localmente' }), { artista: '', segundos: 0 });
    });

    test('lo editado a mano manda', () => {
        assert.equal(datosParaCoincidir({ editado: true, artist: 'Kase.O', channel: 'Subidas varias' }).artista, 'kaseo');
    });
});

describe('coincide', () => {
    const datos = { artista: 'kaze', segundos: 204 };

    test('el canal del artista, aunque sea su VEVO o su «- Topic»', () => {
        assert.ok(coincide({ channel: 'KAZEVEVO', duration: 205 }, datos));
        assert.ok(coincide({ channel: 'KAZE - Topic', duration: 204 }, datos));
    });

    test('o el artista dentro del título, si lo sube otro canal', () => {
        assert.ok(coincide({ channel: 'Rap Español', title: TITULO, duration: 203 }, datos));
    });

    test('otro artista no vale', () => {
        assert.equal(coincide({ channel: 'Natos y Waor', title: 'Natos y Waor - Turbio', duration: 204 }, datos), false);
    });

    test(`la duración, con ${MARGEN_DURACION} s de margen; sin duración en el resultado, no se puede comprobar`, () => {
        assert.ok(coincide({ channel: 'KAZE', duration: 204 + MARGEN_DURACION }, datos));
        assert.equal(coincide({ channel: 'KAZE', duration: 204 + MARGEN_DURACION + 1 }, datos), false);
        assert.equal(coincide({ channel: 'KAZE' }, datos), false);
    });

    test('lo que la canción no sabe no se comprueba', () => {
        assert.ok(coincide({ channel: 'Cualquiera', duration: 999 }, {}));
    });
});

describe('idDeResultados', () => {
    const videoclip = { id: TURBIO, title: TITULO, channel: 'KAZE', duration: 242 };

    test('solo con el título exacto y un único vídeo', () => {
        assert.equal(idDeResultados(TITULO, [{ id: 'xxxxxxxxxxx', title: 'KAZE - Modo Turbio (Live)' }, videoclip]), TURBIO);
        assert.equal(idDeResultados(TITULO, [{ id: 'xxxxxxxxxxx', title: 'KAZE - Modo Turbio (Live)' }]), null, 'parecido no vale');
        assert.equal(idDeResultados(TITULO, [videoclip, { ...videoclip, id: 'yyyyyyyyyyy' }]), null, 'dos iguales: ambiguo');
    });

    test('el artista y la duración deshacen el empate entre dos subidas con el mismo título', () => {
        const resubida = { id: 'yyyyyyyyyyy', title: TITULO, channel: 'Subidas Rap', duration: 204 };
        assert.equal(idDeResultados(TITULO, [videoclip, resubida], { artista: 'kaze', segundos: 241 }), TURBIO);
    });

    test('con el título exacto pero otra duración, no se asigna', () => {
        assert.equal(idDeResultados(TITULO, [videoclip], { artista: 'kaze', segundos: 204 }), null);
    });
});

describe('una sola vez y sin gastar de más (lo que no se prueba sin navegador)', () => {
    const fuente = leer('frontend/src/features/library/caratulas-recuperadas.js');
    const sync = leer('frontend/src/features/sync/sync.js');

    test('el intento se apunta antes de buscar, y una canción ya buscada no se repite', () => {
        assert.match(fuente, /buscadas\[song\.src\] = Date\.now\(\);\s*await StorageModule\.set\(CLAVE_BUSCADAS/);
        assert.match(fuente, /buscadas\[song\.src\]\) continue/);
        assert.match(fuente, /CLAVE_BUSCADAS = 'sync_ids_buscados'/, 'lo buscado antes del plan 27 tampoco se repite');
    });

    test('el tope de búsquedas es de la sesión entera, no de cada vuelta', () => {
        assert.match(fuente, /^let busquedasEnSesion = 0;$/m);
    });

    test('un fallo de red no gasta el intento de la carátula; un 404 sí', () => {
        assert.match(fuente, /if \(!res\.ok\) return null;/);
        assert.match(fuente, /catch \(e\) \{\s*console\.debug\('\[Carátulas\] Sin red[^]*?break;\s*\}\s*intentadas\[song\.src\] = Date\.now\(\);/);
    });

    test('se carga aparte, también desde la sincronización', () => {
        assert.match(sync, /import\('\.\.\/library\/caratulas-recuperadas\.js'\)/);
        assert.doesNotMatch(sync, /^import .*caratulas-recuperadas/m);
    });
});
