/**
 * Dónde aparece «Tu año en música» (plan 17, T6 y T7).
 *
 * Las fechas son lo delicado: la tarjeta sale del 1 de diciembre al 15 de enero
 * y hasta esa fecha sigue enseñando el año anterior. Las funciones que lo deciden
 * son puras y reciben la fecha, así que se prueban sin tocar el reloj.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

// `entrada.js` importa la historia, y con ella el reproductor y la biblioteca,
// que tocan el DOM al cargarse: no se puede importar directamente en Node. Sus
// funciones de fechas son puras, pero salen del arnés.
const {
    ULTIMO_DIA_ENERO, anioDeCampana, anioEnCurso, claveDescarte, estadoTarjeta, tarjetaVisible,
} = app().api;

/** Fecha local, que es con la que se decide (mes en 1-12 para que se lea). */
const dia = (anio, mes, d, hora = 12) => new Date(anio, mes - 1, d, hora);

describe('cuándo se enseña la tarjeta', () => {
    test('el 1 de diciembre, sí', () => {
        assert.equal(tarjetaVisible(dia(2026, 12, 1)), true);
    });

    test('todo diciembre, sí', () => {
        for (const d of [1, 15, 24, 31]) assert.equal(tarjetaVisible(dia(2026, 12, d)), true, `día ${d}`);
    });

    test('el 15 de enero, sí; el 16, no', () => {
        assert.equal(tarjetaVisible(dia(2027, 1, ULTIMO_DIA_ENERO)), true);
        assert.equal(tarjetaVisible(dia(2027, 1, ULTIMO_DIA_ENERO + 1)), false);
    });

    test('el resto del año, no', () => {
        for (const mes of [2, 3, 5, 7, 9, 11]) {
            assert.equal(tarjetaVisible(dia(2026, mes, 10)), false, `mes ${mes}`);
        }
    });

    test('el 30 de noviembre todavía no', () => {
        assert.equal(tarjetaVisible(dia(2026, 11, 30)), false);
    });
});

describe('qué año enseña', () => {
    test('en diciembre, el que está acabando', () => {
        assert.equal(anioDeCampana(dia(2026, 12, 20)), 2026);
    });

    test('en enero, el que acaba de terminar', () => {
        assert.equal(anioDeCampana(dia(2027, 1, 5)), 2026);
        assert.equal(anioDeCampana(dia(2027, 1, ULTIMO_DIA_ENERO)), 2026);
    });

    test('la nochevieja y el día siguiente enseñan años distintos', () => {
        assert.equal(anioDeCampana(dia(2026, 12, 31, 23)), 2026);
        assert.equal(anioDeCampana(dia(2027, 1, 1, 1)), 2026, 'el 1 de enero sigue siendo el resumen de 2026');
    });

    test('«hasta ahora» es siempre el año en curso', () => {
        assert.equal(anioEnCurso(dia(2026, 5, 10)), 2026);
        assert.equal(anioEnCurso(dia(2027, 1, 3)), 2027, 'en enero, el nuevo: lo que llevas de este año');
    });
});

describe('descarte', () => {
    test('la clave lleva el año, para que cerrarla un año no la calle para siempre', () => {
        assert.equal(claveDescarte(2026), 'resumen_descartado_2026');
        assert.notEqual(claveDescarte(2026), claveDescarte(2027));
    });

    test('descartada: no se enseña, pero se sabe de qué año era', async () => {
        const e = await estadoTarjeta(dia(2026, 12, 10), { yaDescartada: async () => true });
        assert.equal(e.visible, false);
        assert.equal(e.anio, 2026);
    });

    test('sin descartar y en temporada: se enseña', async () => {
        const e = await estadoTarjeta(dia(2026, 12, 10), { yaDescartada: async () => false });
        assert.equal(e.visible, true);
        assert.equal(e.anio, 2026);
    });

    test('fuera de temporada no se pregunta ni por el descarte', async () => {
        let preguntas = 0;
        const e = await estadoTarjeta(dia(2026, 6, 10), { yaDescartada: async () => { preguntas++; return false; } });
        assert.equal(e.visible, false);
        assert.equal(preguntas, 0, 'no hace falta mirar el almacenamiento');
    });

    test('el descarte de 2026 no esconde la tarjeta de 2027', async () => {
        const descartados = new Set(['resumen_descartado_2026']);
        const mirar = async (anio) => descartados.has(claveDescarte(anio));
        assert.equal((await estadoTarjeta(dia(2026, 12, 10), { yaDescartada: mirar })).visible, false);
        assert.equal((await estadoTarjeta(dia(2027, 12, 10), { yaDescartada: mirar })).visible, true);
    });
});

describe('enganche con la aplicación', () => {
    test('el descarte se guarda con la clave del año', async () => {
        const { api } = app();
        const guardado = new Map();
        const antesSet = api.StorageModule.set;
        const antesGet = api.StorageModule.get;
        api.StorageModule.set = async (k, v) => { guardado.set(k, v); };
        api.StorageModule.get = async (k) => guardado.get(k) ?? null;
        try {
            const clave = api.claveDescarte(2026);
            await api.StorageModule.set(clave, true);
            const e = await api.estadoTarjeta(dia(2026, 12, 10));
            assert.equal(e.visible, false, 'lo guardado la esconde');
        } finally {
            api.StorageModule.set = antesSet;
            api.StorageModule.get = antesGet;
        }
    });

    test('si el almacenamiento falla, la tarjeta se enseña en vez de esconderse', async () => {
        const { api } = app();
        const antesGet = api.StorageModule.get;
        api.StorageModule.get = async () => { throw new Error('IndexedDB cerrada'); };
        try {
            const e = await api.estadoTarjeta(dia(2026, 12, 10));
            assert.equal(e.visible, true);
        } finally {
            api.StorageModule.get = antesGet;
        }
    });
});
