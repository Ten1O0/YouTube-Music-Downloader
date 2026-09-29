/**
 * De dónde salen las escuchas del resumen del año (plan 17, T3 y T7).
 *
 * Lo que importa aquí es la unión de las dos fuentes: el registro de este
 * dispositivo y las escuchas de la cuenta, que llegan en formato compacto y son
 * dato externo. No puede duplicarse ni una escucha, porque el resumen diría el
 * doble de minutos de los reales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, loadApp, plain } from './harness.mjs';

// `datos.js` habla con la cuenta y con el almacenamiento, así que arrastra
// `auth.js` y con él `ui/status.js`, que toca el DOM al cargarse: no se puede
// importar directamente. Sus funciones puras se sacan del arnés, que carga el
// cliente entero en un navegador simulado.
const arnes = app().api;

// Lo que devuelven las funciones del arnés vive en otro realm, con sus propios
// Array y Object: `plain` lo trae al de los tests para poder compararlo.
const expandirEscuchas = (r) => plain(arnes.expandirEscuchas(r));
const expandirAnteriores = (r) => plain(arnes.expandirAnteriores(r));
const unirEscuchas = (a, b) => plain(arnes.unirEscuchas(a, b));

const TOKEN = 'token-de-prueba';
const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

const fila = (videoId, t, segundos = 180, artista = 'A', cancion = 'C') => ({ videoId, artista, cancion, t, segundos });

/** Respuesta del servidor en el formato compacto de §2.2. */
const respuesta = ({ catalogo = [], escuchas = [], anteriores = [] } = {}) => ({ catalogo, escuchas, anteriores, anio: 2026 });

/**
 * Aplicación cargada con el registro local y la cuenta que se le digan.
 * `escuchasLocales` son las filas de IndexedDB; `deLaCuenta`, lo que responde
 * `GET /api/resumen/escuchas`.
 */
function entorno({ conSesion = true, escuchasLocales = [], deLaCuenta = null, fallaLaCuenta = false, estadoCuenta = 200 } = {}) {
    const { api, context } = loadApp();
    const peticiones = [];

    api.StorageModule.leerEscuchas = async () => copia(escuchasLocales);

    context.fetch = async (url, opts = {}) => {
        peticiones.push({ url: String(url), headers: { ...(opts.headers || {}) } });
        if (fallaLaCuenta) throw new TypeError('Failed to fetch');
        if (estadoCuenta !== 200) return { ok: false, status: estadoCuenta, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => copia(deLaCuenta ?? respuesta()) };
    };

    if (conSesion) {
        api.auth.token = TOKEN;
        api.auth.user = { id: 1, name: 'Prueba' };
    } else {
        api.auth.token = null;
        api.auth.user = null;
    }
    return { api, peticiones };
}

// ========================================
// expandirEscuchas (T3)
// ========================================

describe('expandirEscuchas', () => {
    test('el catálogo se reparte entre sus escuchas', () => {
        const filas = expandirEscuchas(respuesta({
            catalogo: [['aaaaaaaaaaa', 'Rosalia', 'Malamente'], ['bbbbbbbbbbb', 'Kase.O', 'Mazas']],
            escuchas: [[0, 1000, 200], [1, 2000, 300], [0, 3000, 210]],
        }));
        assert.equal(filas.length, 3);
        assert.deepEqual(filas[0], { videoId: 'aaaaaaaaaaa', artista: 'Rosalia', cancion: 'Malamente', t: 1000, segundos: 200 });
        assert.equal(filas[2].cancion, 'Malamente', 'la tercera vuelve a la primera canción');
    });

    test('una respuesta que no tiene la forma esperada no rompe nada', () => {
        for (const mala of [null, undefined, 42, 'texto', {}, { catalogo: 'no', escuchas: 'no' }, { catalogo: [], escuchas: [] }]) {
            assert.deepEqual(expandirEscuchas(mala), []);
        }
    });

    test('las escuchas que apuntan a un catálogo que no existe se descartan', () => {
        const filas = expandirEscuchas(respuesta({
            catalogo: [['aaaaaaaaaaa', 'A', 'C']],
            escuchas: [[0, 1000, 100], [7, 2000, 100], [-1, 3000, 100], ['x', 4000, 100]],
        }));
        assert.equal(filas.length, 1);
    });

    test('un videoId que no lo es se queda vacío, y el resto de la fila se conserva', () => {
        // Ojo: 'no-es-un-id' sí es un id válido (11 caracteres de [\w-], que es
        // el formato de YouTube). Hacen falta ejemplos que de verdad no encajen.
        for (const malo of ['corto', 'demasiado-largo-de-verdad', 'con espacio', '', null, 42, '../../etc/passwd']) {
            const filas = expandirEscuchas(respuesta({
                catalogo: [[malo, 'A', 'C']],
                escuchas: [[0, 1000, 100]],
            }));
            assert.equal(filas[0].videoId, '', `${malo} no es un id de YouTube`);
            assert.equal(filas[0].cancion, 'C', 'pero la escucha se conserva');
        }
    });

    test('los nombres se limpian de caracteres de control y se recortan', () => {
        const filas = expandirEscuchas(respuesta({
            catalogo: [['aaaaaaaaaaa', `Mal\u0000o\u001f`, 'x'.repeat(500)]],
            escuchas: [[0, 1000, 100]],
        }));
        assert.equal(filas[0].artista, 'Mal o');
        assert.equal(filas[0].cancion.length, 120);
    });

    test('los segundos raros se quedan en 0 y los enormes se recortan', () => {
        const filas = expandirEscuchas(respuesta({
            catalogo: [['aaaaaaaaaaa', 'A', 'C']],
            escuchas: [[0, 1000, -5], [0, 2000, 'no'], [0, 3000, 999_999_999], [0, 4000, 120]],
        }));
        assert.deepEqual(filas.map((f) => f.segundos), [0, 0, 86_400, 120]);
    });

    test('un instante que no es un número descarta la escucha', () => {
        const filas = expandirEscuchas(respuesta({
            catalogo: [['aaaaaaaaaaa', 'A', 'C']],
            escuchas: [[0, 'ayer', 100], [0, -1, 100], [0, 5000, 100]],
        }));
        assert.equal(filas.length, 1);
        assert.equal(filas[0].t, 5000);
    });
});

// ========================================
// expandirAnteriores (T3)
// ========================================

describe('expandirAnteriores', () => {
    test('deja los nombres limpios y quita los vacíos', () => {
        assert.deepEqual(
            expandirAnteriores({ anteriores: ['Rosalia', '', '  ', 'Kase.O', 42, null] }),
            ['Rosalia', 'Kase.O']);
    });

    test('sin el campo, lista vacía', () => {
        assert.deepEqual(expandirAnteriores({}), []);
        assert.deepEqual(expandirAnteriores(null), []);
    });
});

// ========================================
// unirEscuchas (T3)
// ========================================

describe('unirEscuchas', () => {
    test('una escucha que está en las dos fuentes no se cuenta dos veces', () => {
        const laMisma = fila('aaaaaaaaaaa', 1000, 180);
        const unidas = unirEscuchas([laMisma], [{ ...laMisma }]);
        assert.equal(unidas.length, 1);
    });

    test('cuando está en las dos, se queda con los segundos mayores', () => {
        // Es el caso real: la sincronización reenvía a propósito la última
        // escucha porque puede haber seguido sumando segundos.
        const unidas = unirEscuchas([fila('aaaaaaaaaaa', 1000, 30)], [fila('aaaaaaaaaaa', 1000, 200)]);
        assert.equal(unidas.length, 1);
        assert.equal(unidas[0].segundos, 200);
    });

    test('si la de la cuenta tiene más segundos, se queda la de la cuenta', () => {
        const unidas = unirEscuchas([fila('aaaaaaaaaaa', 1000, 200)], [fila('aaaaaaaaaaa', 1000, 30)]);
        assert.equal(unidas[0].segundos, 200);
    });

    test('el mismo vídeo en otro instante son dos escuchas', () => {
        const unidas = unirEscuchas([fila('aaaaaaaaaaa', 1000)], [fila('aaaaaaaaaaa', 1001)]);
        assert.equal(unidas.length, 2);
    });

    test('las locales que no han subido nunca se añaden', () => {
        const unidas = unirEscuchas([fila('aaaaaaaaaaa', 1000)], [fila('bbbbbbbbbbb', 2000), fila('ccccccccccc', 3000)]);
        assert.equal(unidas.length, 3);
    });

    test('las locales sin videoId (que no suben nunca) también entran', () => {
        const unidas = unirEscuchas([], [fila('', 1000), fila('', 2000)]);
        assert.equal(unidas.length, 2, 'las distingue el instante');
    });

    test('el resultado va ordenado por instante', () => {
        const unidas = unirEscuchas([fila('aaaaaaaaaaa', 3000)], [fila('bbbbbbbbbbb', 1000), fila('ccccccccccc', 2000)]);
        assert.deepEqual(unidas.map((e) => e.t), [1000, 2000, 3000]);
    });

    test('sin nada en ninguna de las dos, nada', () => {
        assert.deepEqual(unirEscuchas([], []), []);
    });
});

// ========================================
// reunirEscuchas y resumenDelAnio (T3)
// ========================================

describe('reunirEscuchas', () => {
    test('sin sesión no se llama a la cuenta y se usa solo el registro local', async () => {
        const { api, peticiones } = entorno({
            conSesion: false,
            escuchasLocales: [{ id: 1, videoId: 'aaaaaaaaaaa', artista: 'A', cancion: 'C', t: 1000, segundos: 200 }],
        });
        const r = plain(await api.reunirEscuchas(2026));
        assert.equal(peticiones.length, 0, 'sin sesión no hay petición');
        assert.equal(r.fuente, 'local');
        assert.equal(r.escuchas.length, 1);
        assert.deepEqual(r.artistasAnteriores, []);
    });

    test('con sesión se suman las de la cuenta y las locales, sin duplicar', async () => {
        const { api, peticiones } = entorno({
            escuchasLocales: [
                { id: 1, videoId: 'aaaaaaaaaaa', artista: 'A', cancion: 'C', t: 1000, segundos: 200 },
                { id: 2, videoId: 'bbbbbbbbbbb', artista: 'B', cancion: 'D', t: 5000, segundos: 150 },
            ],
            deLaCuenta: respuesta({
                catalogo: [['aaaaaaaaaaa', 'A', 'C'], ['ccccccccccc', 'C', 'E']],
                escuchas: [[0, 1000, 200], [1, 9000, 300]],
                anteriores: ['Viejo'],
            }),
        });
        const r = plain(await api.reunirEscuchas(2026));
        assert.equal(r.fuente, 'cuenta');
        assert.deepEqual(r.escuchas.map((e) => e.t), [1000, 5000, 9000], 'la de t=1000 está en las dos y sale una vez');
        assert.deepEqual(r.artistasAnteriores, ['Viejo']);
        assert.match(peticiones[0].url, /\/api\/resumen\/escuchas\?anio=2026$/);
        assert.equal(peticiones[0].headers.Authorization, `Bearer ${TOKEN}`);
    });

    test('si la cuenta no responde, se sigue con lo local', async () => {
        const { api } = entorno({
            fallaLaCuenta: true,
            escuchasLocales: [{ id: 1, videoId: 'aaaaaaaaaaa', artista: 'A', cancion: 'C', t: 1000, segundos: 200 }],
        });
        const r = plain(await api.reunirEscuchas(2026));
        assert.equal(r.fuente, 'local', 'sin red, el resumen de este dispositivo');
        assert.equal(r.escuchas.length, 1);
    });

    test('si la cuenta contesta con error, se sigue con lo local', async () => {
        const { api } = entorno({ estadoCuenta: 429, escuchasLocales: [{ id: 1, videoId: 'aaaaaaaaaaa', t: 1000, segundos: 200 }] });
        const r = plain(await api.reunirEscuchas(2026));
        assert.equal(r.fuente, 'local');
    });

    test('si el registro local falla, se usa lo de la cuenta', async () => {
        const { api } = entorno({
            deLaCuenta: respuesta({ catalogo: [['aaaaaaaaaaa', 'A', 'C']], escuchas: [[0, 1000, 200]] }),
        });
        api.StorageModule.leerEscuchas = async () => { throw new Error('IndexedDB cerrada'); };
        const r = plain(await api.reunirEscuchas(2026));
        assert.equal(r.escuchas.length, 1);
        assert.equal(r.fuente, 'cuenta');
    });

    test('el año pedido viaja en la petición', async () => {
        const { api, peticiones } = entorno({});
        await api.reunirEscuchas(2025);
        assert.match(peticiones[0].url, /anio=2025$/);
    });
});

describe('resumenDelAnio', () => {
    test('devuelve el resumen ya calculado y de dónde salen los datos', async () => {
        const dia = Date.UTC(2026, 4, 10, 12);
        const { api } = entorno({
            escuchasLocales: Array.from({ length: 25 }, (_, i) => ({
                id: i + 1, videoId: 'aaaaaaaaaaa', artista: 'Rosalia', cancion: 'Malamente',
                t: dia + i * 86_400_000, segundos: 200,
            })),
            deLaCuenta: respuesta(),
        });
        const r = plain(await api.resumenDelAnio(2026));
        assert.equal(r.anio, 2026);
        assert.equal(r.escuchas, 25);
        assert.equal(r.suficiente, true);
        assert.equal(r.artistaPrincipal.artista, 'Rosalia');
        assert.equal(r.cancionDelAnio.cancion, 'Malamente');
        assert.equal(r.fuente, 'cuenta');
    });

    test('con poca música avisa de que no basta, y de cuánto falta', async () => {
        const { api } = entorno({
            conSesion: false,
            escuchasLocales: [{ id: 1, videoId: 'aaaaaaaaaaa', artista: 'A', cancion: 'C', t: Date.UTC(2026, 4, 10, 12), segundos: 200 }],
        });
        const r = plain(await api.resumenDelAnio(2026));
        assert.equal(r.suficiente, false);
        assert.ok(r.faltan.escuchas > 0);
        assert.ok(r.faltan.minutos > 0);
    });

    test('un artista que la cuenta ya conocía no es un descubrimiento', async () => {
        const dia = Date.UTC(2026, 4, 10, 12);
        const locales = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1, videoId: 'aaaaaaaaaaa', artista: 'ROSALÍA', cancion: 'C', t: dia + i * 86_400_000, segundos: 200,
        }));
        const sinAnteriores = entorno({ escuchasLocales: locales, deLaCuenta: respuesta() });
        assert.equal(plain(await sinAnteriores.api.resumenDelAnio(2026)).descubrimientos.length, 1);

        const conAnteriores = entorno({ escuchasLocales: locales, deLaCuenta: respuesta({ anteriores: ['rosalia'] }) });
        assert.deepEqual(plain(await conAnteriores.api.resumenDelAnio(2026)).descubrimientos, [],
            'lo que ya se escuchaba en otro dispositivo no es descubrimiento');
    });
});

describe('zonaHorariaActual', () => {
    test('devuelve una zona utilizable', async () => {
        const { api } = entorno({});
        const zona = api.zonaHorariaActual();
        assert.equal(typeof zona, 'string');
        assert.ok(zona.length > 0);
        assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zona }));
    });
});
