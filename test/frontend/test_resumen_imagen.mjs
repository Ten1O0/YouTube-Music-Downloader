/**
 * La imagen de «Tu año en música» (plan 17, T5 y T7).
 *
 * `dibujarResumen` solo usa `fillRect`, `fillText` y `drawImage`, así que se
 * puede probar con un contexto de mentira que apunte todo lo que se le pide. Es
 * la forma de comprobar qué acaba en la imagen —y qué no— sin un navegador.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, loadApp, plain } from './harness.mjs';

const arnes = app().api;
const { ALTO, ANCHO, datosDeImagen, dibujarResumen, recortar } = arnes;

/** Contexto 2D de mentira: apunta cada llamada para poder afirmar sobre ella. */
function contextoFalso({ anchoPorCaracter = 18 } = {}) {
    const textos = [];
    const rectangulos = [];
    const imagenes = [];
    const degradados = [];
    const ctx = {
        canvas: { width: ANCHO, height: ALTO },
        globalAlpha: 1,
        fillStyle: '',
        font: '',
        textAlign: '',
        fillText: (texto, x, y) => textos.push({ texto, x, y, font: ctx.font, fillStyle: ctx.fillStyle }),
        fillRect: (x, y, w, h) => rectangulos.push({ x, y, w, h, fillStyle: ctx.fillStyle }),
        drawImage: (img, x, y, w, h) => imagenes.push({ x, y, w, h }),
        measureText: (texto) => ({ width: String(texto).length * anchoPorCaracter }),
        createLinearGradient: () => nuevoDegradado('linear'),
        createRadialGradient: () => nuevoDegradado('radial'),
    };
    function nuevoDegradado(tipo) {
        const g = { tipo, paradas: [], addColorStop: (p, c) => g.paradas.push([p, c]) };
        degradados.push(g);
        return g;
    }
    return { ctx, textos, rectangulos, imagenes, degradados, dichos: () => textos.map((t) => t.texto) };
}

const t = (clave, params) => (params ? `${clave}:${Object.values(params).join(',')}` : clave);

const resumen = () => ({
    anio: 2026,
    minutos: 8452,
    artistas: [
        { artista: 'Rosalia', minutos: 900 }, { artista: 'Kase.O', minutos: 700 },
        { artista: 'Nathy Peluso', minutos: 500 }, { artista: 'C. Tangana', minutos: 300 },
        { artista: 'Zahara', minutos: 100 }, { artista: 'Sobra', minutos: 10 },
    ],
    canciones: [
        { cancion: 'Malamente', escuchas: 30 }, { cancion: 'Saoko', escuchas: 20 },
        { cancion: 'Mazas', escuchas: 15 }, { cancion: 'Mafiosa', escuchas: 10 },
        { cancion: 'Merichane', escuchas: 5 }, { cancion: 'Sobra', escuchas: 1 },
    ],
});

const PALETA = ['#DFCDAC', '#6F8F6A', '#141A14'];

describe('medidas', () => {
    test('el formato de las historias: 1080 × 1920', () => {
        assert.equal(ANCHO, 1080);
        assert.equal(ALTO, 1920);
    });
});

describe('datosDeImagen', () => {
    test('coge los cinco primeros de cada lista, no más', () => {
        const d = plain(datosDeImagen(resumen(), t));
        assert.equal(d.artistas.length, 5);
        assert.equal(d.canciones.length, 5);
        assert.ok(!d.artistas.includes('Sobra'));
        assert.ok(!d.canciones.includes('Sobra'));
    });

    test('un resumen vacío no revienta', () => {
        const d = plain(datosDeImagen(null, t));
        assert.equal(d.minutos, 0);
        assert.deepEqual(d.artistas, []);
        assert.deepEqual(d.canciones, []);
    });

    test('los nombres vacíos se caen de la lista', () => {
        const d = plain(datosDeImagen({ anio: 2026, artistas: [{ artista: '' }, { artista: 'Real' }], canciones: [] }, t));
        assert.deepEqual(d.artistas, ['Real']);
    });
});

describe('recortar', () => {
    test('lo que cabe se queda tal cual', () => {
        const { ctx } = contextoFalso();
        assert.equal(recortar(ctx, 'corto', 1000), 'corto');
    });

    test('lo que no cabe se corta con puntos suspensivos', () => {
        const { ctx } = contextoFalso({ anchoPorCaracter: 50 });
        const salida = recortar(ctx, 'un nombre de artista larguísimo', 300);
        assert.ok(salida.endsWith('…'));
        assert.ok(salida.length < 'un nombre de artista larguísimo'.length);
    });

    test('un texto vacío o nulo no rompe', () => {
        const { ctx } = contextoFalso();
        assert.equal(recortar(ctx, '', 100), '');
        assert.equal(recortar(ctx, null, 100), '');
    });
});

describe('dibujarResumen', () => {
    test('pinta el año, los minutos y las dos listas', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, resumen(), PALETA, { t });
        const dichos = c.dichos();
        assert.ok(dichos.some((x) => x.includes('wrapped_final_title:2026')), 'el título con el año');
        assert.ok(dichos.includes('8452'), 'los minutos');
        assert.ok(dichos.includes('Rosalia'));
        assert.ok(dichos.includes('Malamente'));
        assert.ok(dichos.includes('Zahara'), 'el quinto artista también');
    });

    test('las posiciones van numeradas del 1 al 5, en las dos listas', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, resumen(), PALETA, { t });
        for (const n of ['1', '2', '3', '4', '5']) {
            assert.equal(c.dichos().filter((x) => x === n).length, 2, `el ${n} aparece en las dos columnas`);
        }
    });

    test('todo el texto va con fillText, que no interpreta nada', () => {
        const c = contextoFalso();
        const malicioso = {
            ...resumen(),
            artistas: [{ artista: '<img src=x onerror=alert(1)>' }],
            canciones: [{ cancion: '"><script>alert(1)</script>' }],
        };
        dibujarResumen(c.ctx, malicioso, PALETA, { t });
        assert.ok(c.dichos().some((x) => x.includes('<img src=x')), 'se dibuja como texto, literal');
        assert.equal(c.imagenes.length, 0, 'y no se ha cargado ninguna imagen');
    });

    test('la imagen no lleva nada de la cuenta', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, { ...resumen(), correo: 'yo@example.com', foto: 'https://foto' }, PALETA, { t });
        const todo = c.dichos().join(' | ');
        assert.ok(!todo.includes('@'), 'ni el correo');
        assert.ok(!todo.includes('foto'), 'ni la foto');
    });

    test('con carátula legible se dibuja la imagen', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, resumen(), PALETA, { t, imagen: { width: 480, height: 480 } });
        assert.equal(c.imagenes.length, 1);
        assert.equal(c.imagenes[0].w, c.imagenes[0].h, 'cuadrada');
        assert.ok(c.imagenes[0].x > 0 && c.imagenes[0].x + c.imagenes[0].w < ANCHO, 'dentro del lienzo');
    });

    test('sin carátula legible va un cuadro del color de la paleta, no un hueco', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, resumen(), PALETA, { t, imagen: null });
        assert.equal(c.imagenes.length, 0);
        const cuadro = c.rectangulos.find((r) => r.w === r.h && r.w > 300);
        assert.ok(cuadro, 'hay un cuadro grande');
        assert.equal(cuadro.fillStyle, PALETA[1]);
    });

    test('el fondo cubre el lienzo entero', () => {
        const c = contextoFalso();
        dibujarResumen(c.ctx, resumen(), PALETA, { t });
        assert.ok(c.rectangulos.some((r) => r.x === 0 && r.y === 0 && r.w === ANCHO && r.h === ALTO));
        assert.equal(c.degradados.length, 2, 'el vertical y el halo');
    });

    test('una paleta que no vale cae a los colores de la casa', () => {
        for (const mala of [null, undefined, [], ['#fff'], 'azul']) {
            const c = contextoFalso();
            assert.doesNotThrow(() => dibujarResumen(c.ctx, resumen(), mala, { t }));
            assert.ok(c.dichos().includes('8452'), 'y sigue dibujando los datos');
        }
    });

    test('un resumen sin nada dibuja el fondo y el cero, sin fallar', () => {
        const c = contextoFalso();
        assert.doesNotThrow(() => dibujarResumen(c.ctx, null, PALETA, { t }));
        assert.ok(c.dichos().includes('0'));
    });

    test('los nombres muy largos se recortan para no salirse', () => {
        const c = contextoFalso({ anchoPorCaracter: 40 });
        const largo = 'Un nombre de artista absurdamente largo que no cabe de ninguna manera';
        dibujarResumen(c.ctx, { ...resumen(), artistas: [{ artista: largo }] }, PALETA, { t });
        const pintado = c.dichos().find((x) => x.startsWith('Un no'));
        assert.ok(pintado, `no encuentro el nombre recortado en: ${c.dichos().join(' | ')}`);
        assert.ok(pintado.endsWith('…'), 'recortado');
        assert.ok(pintado.length < largo.length);
        assert.ok(!c.dichos().includes(largo), 'el nombre entero no se pinta nunca');
    });
});

describe('guardarImagen', () => {
    test('en la web entrega el fichero y devuelve su nombre', async () => {
        const { api, context } = loadApp();
        const descargas = [];
        context.document.createElement = (tag) => {
            if (tag === 'canvas') {
                return {
                    width: 0, height: 0,
                    getContext: () => contextoFalso().ctx,
                    toBlob: (cb) => cb(new context.Blob(['png'], { type: 'image/png' })),
                };
            }
            const a = { set href(v) { this._href = v; }, get href() { return this._href; },
                download: '', click() { descargas.push(this.download); }, remove() {} };
            return a;
        };
        const donde = await api.guardarImagen({ anio: 2026, minutos: 10, artistas: [], canciones: [] }, PALETA);
        assert.equal(donde, 'music-downloader-2026.png');
        assert.deepEqual(descargas, ['music-downloader-2026.png']);
    });

    test('si el lienzo no da imagen, devuelve null en vez de fingir que fue bien', async () => {
        const { api, context } = loadApp();
        context.document.createElement = () => ({
            width: 0, height: 0,
            getContext: () => contextoFalso().ctx,
            toBlob: (cb) => cb(null),
        });
        const donde = await api.guardarImagen({ anio: 2026, minutos: 10, artistas: [], canciones: [] }, PALETA);
        assert.equal(donde, null);
    });

    test('sin contexto 2D tampoco revienta', async () => {
        const { api, context } = loadApp();
        context.document.createElement = () => ({ width: 0, height: 0, getContext: () => null });
        assert.equal(await api.guardarImagen({ anio: 2026 }, PALETA), null);
    });
});
