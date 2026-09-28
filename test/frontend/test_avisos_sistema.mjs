/**
 * Avisos del sistema (plan 14, T5): qué avisos salen en cada caso de §2.4,
 * con el plugin de Capacitor simulado.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    MIN_LOTE_PARA_AVISAR, _reiniciarAvisos, avisarSistema, avisoDeLote, initAvisosSistema,
} from '../../frontend/src/native/notifications.js';

const t = (clave, p = {}) => `${clave}${Object.keys(p).length ? JSON.stringify(p) : ''}`;

function pluginFalso({ permiso = 'granted' } = {}) {
    const llamadas = { canales: [], avisos: [], oyentes: {} };
    return {
        llamadas,
        checkPermissions: async () => ({ display: permiso }),
        createChannel: async (c) => { llamadas.canales.push(c); },
        schedule: async ({ notifications }) => { llamadas.avisos.push(...notifications); },
        addListener: (evento, fn) => { llamadas.oyentes[evento] = fn; },
    };
}

beforeEach(() => _reiniciarAvisos());

test('avisoDeLote: un lote corto no avisa (sería ruido)', () => {
    assert.equal(avisoDeLote({ total: 1 }, t), null);
    assert.equal(avisoDeLote({ total: MIN_LOTE_PARA_AVISAR - 1 }, t), null);
});

test('avisoDeLote: 5 o más, «Listo: N canciones»; con fallos, «No se pudieron N de M»', () => {
    const ok = avisoDeLote({ total: 23 }, t);
    assert.equal(ok.texto, 'notif_batch_done{"n":23}');
    assert.deepEqual(ok.destino, { vista: 'library' });
    const mal = avisoDeLote({ total: 23, fallidas: 3 }, t);
    assert.equal(mal.texto, 'notif_batch_failed{"n":3,"total":23}');
});

test('con la app a la vista no hay aviso del sistema: para eso están la isla y el banner', async () => {
    const LN = pluginFalso();
    assert.equal(await avisarSistema({ titulo: 'T', texto: 'x' }, { LN, visible: true }), false);
    assert.equal(LN.llamadas.avisos.length, 0);
});

test('fuera de la APK (sin plugin) no hace nada y no falla', async () => {
    assert.equal(await avisarSistema({ titulo: 'T', texto: 'x' }, { LN: null, visible: false }), false);
});

test('sin permiso no avisa ni lo pide; con permiso más tarde, sí', async () => {
    const sin = pluginFalso({ permiso: 'denied' });
    assert.equal(await avisarSistema({ titulo: 'T', texto: 'x' }, { LN: sin, visible: false }), false);
    assert.equal(sin.llamadas.avisos.length, 0);
    const con = pluginFalso();
    assert.equal(await avisarSistema({ titulo: 'T', texto: 'x' }, { LN: con, visible: false }), true);
});

test('en segundo plano: canal «descargas» una vez, sin sonido, e ids distintos', async () => {
    const LN = pluginFalso();
    await avisarSistema({ titulo: 'Uno', texto: 'a', destino: { vista: 'playlist', id: '1' } }, { LN, visible: false });
    await avisarSistema({ titulo: 'Dos', texto: 'b' }, { LN, visible: false });
    assert.equal(LN.llamadas.canales.length, 1);
    assert.equal(LN.llamadas.canales[0].id, 'descargas');
    assert.equal(LN.llamadas.canales[0].sound, null);
    const [a, b] = LN.llamadas.avisos;
    assert.equal(a.channelId, 'descargas');
    assert.notEqual(a.id, b.id);
    assert.ok(Number.isInteger(a.id) && a.id > 0 && a.id < 2 ** 31);
    assert.deepEqual(a.extra, { destino: { vista: 'playlist', id: '1' } });
});

test('el texto va plano y recortado', async () => {
    const LN = pluginFalso();
    await avisarSistema({ titulo: 'x'.repeat(500), texto: 'y'.repeat(1000) }, { LN, visible: false });
    assert.equal(LN.llamadas.avisos[0].title.length, 120);
    assert.equal(LN.llamadas.avisos[0].body.length, 300);
});

test('tocar el aviso abre su destino', () => {
    const LN = pluginFalso();
    const abiertos = [];
    initAvisosSistema({ alTocar: (d) => abiertos.push(d) }, LN);
    LN.llamadas.oyentes.localNotificationActionPerformed({ notification: { extra: { destino: { vista: 'playlist', id: '7' } } } });
    LN.llamadas.oyentes.localNotificationActionPerformed({ notification: {} });
    assert.deepEqual(abiertos, [{ vista: 'playlist', id: '7' }, null]);
});
