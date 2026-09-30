/**
 * Cargar cada cosa al usarla (plan 19, T11): la carga ocurre una sola vez,
 * aunque la pidan a la vez el primer toque y la precarga en reposo, y si
 * falla (sin conexión) se puede reintentar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diferido } from '../../frontend/src/ui/diferido.js';

test('se carga una sola vez aunque se pida a la vez desde dos sitios', async () => {
    let cargas = 0;
    const obtener = diferido(async () => { cargas++; return 'módulo'; });
    assert.equal(obtener.listo, false);
    const [a, b] = await Promise.all([obtener(), obtener()]);
    assert.equal(a, 'módulo');
    assert.equal(b, 'módulo');
    assert.equal(await obtener(), 'módulo');
    assert.equal(cargas, 1);
    assert.equal(obtener.listo, true);
});

test('si falla, el siguiente intento vuelve a cargar', async () => {
    let intentos = 0;
    const obtener = diferido(async () => {
        intentos++;
        if (intentos === 1) throw new Error('sin conexión');
        return 'módulo';
    });
    await assert.rejects(obtener(), /sin conexión/);
    assert.equal(obtener.listo, false);
    assert.equal(await obtener(), 'módulo');
    assert.equal(obtener.listo, true);
    assert.equal(intentos, 2);
});
