/**
 * El planificador del trabajo de fondo (plan 19, T12): prioridades, pausa
 * mientras el usuario toca o hace scroll, y trozos cortos.
 *
 * Con un reloj y un «hueco del navegador» falsos: los huecos se dan a mano,
 * uno a uno, para ver exactamente a quién le toca cada vez.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ceder, esperarTurno, marcarOcupado, PRIORIDAD, QUIETO_BAJA_MS, QUIETO_MS, tarea, TROZO_MS, usuarioOcupado, _probar } from '../../frontend/src/ui/tareas.js';

let reloj;
let huecos;
let sim;
let animando;

/** Da el siguiente hueco del navegador y deja correr las promesas. */
async function hueco() {
    const fn = huecos.shift();
    assert.ok(fn, 'no había nadie esperando un hueco');
    fn();
    await new Promise((ok) => setImmediate(ok));
}

beforeEach(() => {
    reloj = 1_000;
    huecos = [];
    animando = false;
    sim = _probar({ ahora: () => reloj, hueco: (fn) => huecos.push(fn), animando: () => animando });
});

describe('turnos', () => {
    test('primero lo más prioritario y, a igualdad, lo más antiguo', async () => {
        const orden = [];
        tarea(() => orden.push('baja'), { prioridad: PRIORIDAD.baja });
        tarea(() => orden.push('normal 1'));
        tarea(() => orden.push('alta'), { prioridad: PRIORIDAD.alta });
        tarea(() => orden.push('normal 2'));
        await new Promise((ok) => setImmediate(ok));
        for (let i = 0; i < 4; i++) await hueco();
        assert.deepEqual(orden, ['alta', 'normal 1', 'normal 2', 'baja']);
    });

    test('un turno por hueco del navegador', async () => {
        const hechas = [];
        tarea(() => hechas.push(1));
        tarea(() => hechas.push(2));
        await hueco();
        assert.deepEqual(hechas, [1]);
        await hueco();
        assert.deepEqual(hechas, [1, 2]);
    });

    test('devuelve lo que devuelve la tarea', async () => {
        const p = tarea(async () => 42);
        await hueco();
        assert.equal(await p, 42);
    });
});

describe('cede ante el usuario', () => {
    test('con un dedo en la pantalla no se trabaja, y al levantarlo sí', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let hecha = false;
        sim.dedo(true);
        tarea(() => { hecha = true; });
        await hueco();
        assert.equal(hecha, false);
        assert.equal(sim.pendientes(), 1);

        sim.dedo(false);
        reloj += QUIETO_MS;
        t.mock.timers.tick(QUIETO_MS);
        await hueco();
        assert.equal(hecha, true);
    });

    test('tras un scroll espera a que pase un rato quieto', () => {
        sim.gesto();
        assert.equal(usuarioOcupado(), true);
        reloj += QUIETO_MS - 1;
        assert.equal(usuarioOcupado(), true);
        reloj += 1;
        assert.equal(usuarioOcupado(), false);
    });

    test('lo de prioridad baja espera 2 s de calma; lo normal, 300 ms', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const hechas = [];
        sim.gesto();
        tarea(() => hechas.push('baja'), { prioridad: PRIORIDAD.baja });
        tarea(() => hechas.push('normal'));
        reloj += QUIETO_MS;
        await hueco();
        assert.deepEqual(hechas, ['normal'], 'pasados 300 ms, lo normal ya trabaja');
        await hueco();
        assert.deepEqual(hechas, ['normal'], 'lo de prioridad baja, todavía no: no se cuela entre dos gestos');
        reloj += QUIETO_BAJA_MS - QUIETO_MS;
        t.mock.timers.tick(QUIETO_MS);
        await hueco();
        assert.deepEqual(hechas, ['normal', 'baja']);
    });

    test('un dedo «puesto» durante más de 10 s es un pointerup perdido: no bloquea para siempre', () => {
        sim.dedo(true);
        reloj += 9_999;
        assert.equal(usuarioOcupado(), true);
        reloj += 1;
        assert.equal(usuarioOcupado(), false);
    });

    test('mientras dura una animación, y lo que se marque como ocupado', () => {
        animando = true;
        assert.equal(usuarioOcupado(), true);
        animando = false;
        marcarOcupado(200);
        assert.equal(usuarioOcupado(), true);
        reloj += 200;
        assert.equal(usuarioOcupado(), false);
    });
});

describe('trozos', () => {
    test('ceder() sigue sin esperar mientras el trozo es corto', async () => {
        const p = esperarTurno();
        await hueco();
        await p;
        reloj += TROZO_MS - 1;
        await ceder();
        assert.equal(huecos.length, 0);
    });

    test('pasado el trozo, ceder() espera otro turno', async () => {
        const p = esperarTurno();
        await hueco();
        await p;
        reloj += TROZO_MS;
        let siguio = false;
        ceder().then(() => { siguio = true; });
        await new Promise((ok) => setImmediate(ok));
        assert.equal(siguio, false);
        await hueco();
        assert.equal(siguio, true);
    });

    test('si el usuario toca a mitad, ceder() espera aunque quede trozo', async () => {
        const p = esperarTurno();
        await hueco();
        await p;
        sim.gesto();
        let siguio = false;
        ceder().then(() => { siguio = true; });
        await new Promise((ok) => setImmediate(ok));
        assert.equal(siguio, false);
    });
});
