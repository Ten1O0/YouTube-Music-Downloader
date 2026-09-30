/**
 * El visualizador y los ajustes de reproducción (plan 12, T7 y T8): las
 * bandas de frecuencia, las alturas, los colores y el saneado de lo guardado.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aclarar, alturas, bandasLog, BARRAS, puedeVisualizar } from '../../frontend/src/features/player/visualizer.js';
import { AJUSTES_POR_DEFECTO, sanearAjustes } from '../../frontend/src/features/player/settings-model.js';

describe('bandasLog', () => {
    const bandas = bandasLog(128, 48000);

    test(`${BARRAS} bandas, en orden y dentro de la FFT`, () => {
        assert.equal(bandas.length, BARRAS);
        for (const [desde, hasta] of bandas) {
            assert.ok(desde >= 0 && hasta <= 127 && desde <= hasta);
        }
        for (let i = 1; i < bandas.length; i++) assert.ok(bandas[i][0] >= bandas[i - 1][0]);
    });

    test('escala logarítmica: las agudas abarcan muchos más bins que las graves', () => {
        const ancho = ([d, h]) => h - d + 1;
        assert.ok(ancho(bandas.at(-1)) > ancho(bandas[4]) * 4);
    });

    test('con una frecuencia baja, no se sale de la mitad de muestreo', () => {
        for (const [, hasta] of bandasLog(128, 22050)) assert.ok(hasta <= 127);
    });
});

test('alturas: el máximo de cada banda, de 0 a 1', () => {
    const datos = new Uint8Array(8);
    datos[1] = 255; datos[5] = 51;
    assert.deepEqual(alturas(datos, [[0, 1], [2, 4], [5, 7]]), [1, 0, 0.2]);
});

describe('aclarar', () => {
    test('mezcla con blanco', () => {
        assert.equal(aclarar('#000000', 0.5), '#808080');
        assert.equal(aclarar('#ffffff', 0.3), '#ffffff');
        assert.equal(aclarar(' #102030 ', 0), '#102030');
    });

    test('un color que no se entiende vuelve al dorado de la casa', () => {
        for (const c of ['', 'rgb(1,2,3)', '#abc', undefined]) assert.equal(aclarar(c), '#DFCDAC');
    });
});

test('sin captureStream (Firefox, Safari) no hay visualizador', () => {
    assert.equal(puedeVisualizar({}), false);
    assert.equal(puedeVisualizar(null), false);
});

describe('sanearAjustes', () => {
    test('sin nada guardado, los de por defecto: sin cortes, igualar, visualizador y la radio apagada solo con Wi-Fi', () => {
        assert.deepEqual(sanearAjustes(undefined), { fundido: 0, igualar: true, visualizador: true, radio: false, radioSoloWifi: true });
        assert.deepEqual(sanearAjustes(null), { ...AJUSTES_POR_DEFECTO });
    });

    test('respeta lo válido', () => {
        assert.deepEqual(
            sanearAjustes({ fundido: 8, igualar: false, visualizador: false, radio: true, radioSoloWifi: false }),
            { fundido: 8, igualar: false, visualizador: false, radio: true, radioSoloWifi: false },
        );
    });

    test('lo raro vuelve al de por defecto, campo a campo', () => {
        assert.deepEqual(sanearAjustes({ fundido: 7, igualar: 'no', visualizador: 0, radio: 'sí', radioSoloWifi: 1 }), { ...AJUSTES_POR_DEFECTO });
        assert.equal(sanearAjustes({ fundido: '4' }).fundido, 0);
        assert.equal(sanearAjustes({ fundido: 12 }).fundido, 12);
    });
});
