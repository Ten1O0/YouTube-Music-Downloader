/**
 * Los muelles en el compositor (plan 28).
 *
 * La curva tiene que ser la misma que recorre `Spring`: si se desfasa, el
 * vuelo, el arrastre y la respiración de la carátula se moverían distinto en
 * la web y sin Web Animations. Y darle la vuelta a mitad tiene que seguir
 * desde donde iba y con la velocidad que llevaba, sin quedarse a medias si
 * termina una animación ya sustituida.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { curvaDesde, enInstante, animarCurva, muelleEnCompositor } from '../../frontend/src/ui/motion/curva.js';
import { fly, flightPose } from '../../frontend/src/ui/motion/flight.js';
import { volarReproductor, sombraQueRespira } from '../../frontend/src/features/player/movimiento-fp.js';
import { curvaDeMuelle, scheduler, Spring } from '../../frontend/src/ui/motion/spring.js';
import { leer } from './fuentes.mjs';

const cerca = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** Un elemento que apunta cada `animate()` y deja terminarlo o cancelarlo a mano. */
function elementoFalso(extra = {}) {
    const el = {
        style: {},
        animaciones: [],
        animate(fotogramas, opciones) {
            let terminar, abortar;
            const a = {
                fotogramas, opciones, currentTime: 0, cancelada: false,
                finished: new Promise((ok, ko) => { terminar = ok; abortar = ko; }),
                terminar() { terminar(a); },
                cancel() { a.cancelada = true; abortar(new Error('AbortError')); },
            };
            a.finished.catch(() => {});
            el.animaciones.push(a);
            return a;
        },
        ...extra,
    };
    return el;
}

const vivas = (el) => el.animaciones.filter((a) => !a.cancelada);

before(() => { scheduler.slow = 1; });

describe('curvaDesde', () => {
    test('desde 0, la misma curva fotograma a fotograma que la de los tokens de muelle', () => {
        const curva = curvaDesde({ preset: 'smooth' });
        const puntos = curvaDeMuelle('smooth').easing.slice(7, -1).split(', ').map(Number);
        const n = Math.min(curva.valores.length, puntos.length) - 1;
        assert.ok(n > 20);
        for (let i = 0; i < n; i++) assert.ok(cerca(curva.valores[i], puntos[i], 1e-5), `fotograma ${i}`);
    });

    test('con velocidad de salida, la misma que Spring con esa velocidad', () => {
        let ahora = 0, pendiente = null;
        Object.assign(scheduler, { now: () => ahora, request: (cb) => { pendiente = cb; return 1; }, cancel: () => { pendiente = null; } });
        const vistos = [];
        const muelle = new Spring({ value: 0.3, preset: 'snappy', precision: 0.001, onUpdate: (x) => vistos.push(x) });
        muelle.to(1, { velocity: -2 });
        while (pendiente) { const cb = pendiente; pendiente = null; ahora += 1000 / 60; cb(ahora); }
        const curva = curvaDesde({ desde: 0.3, hasta: 1, velocidad: -2, preset: 'snappy' });
        const quieta = curvaDesde({ desde: 0.3, hasta: 1, preset: 'snappy' });
        assert.ok(curva.valores[3] < quieta.valores[3] - 0.02, 'no sale con la velocidad del dedo');
        for (let i = 1; i < Math.min(vistos.length, curva.valores.length) - 1; i++) {
            assert.ok(cerca(vistos[i - 1], curva.valores[i], 1e-4), `fotograma ${i}`);
        }
    });

    test('acaba justo en el destino, quieta, y dura lo que sus fotogramas', () => {
        const curva = curvaDesde({ desde: 1, hasta: 0, velocidad: 3 });
        assert.equal(curva.valores[0], 1);
        assert.equal(curva.velocidades[0], 3);
        assert.equal(curva.valores.at(-1), 0);
        assert.equal(curva.velocidades.at(-1), 0);
        assert.equal(curva.durationMs, (curva.valores.length - 1) * 1000 / 60);
    });
});

describe('enInstante', () => {
    const curva = curvaDesde({ preset: 'smooth' });

    test('entre dos fotogramas, la mezcla de los dos', () => {
        const { valor, velocidad } = enInstante(curva, 2.5 * 1000 / 60);
        assert.ok(cerca(valor, (curva.valores[2] + curva.valores[3]) / 2, 1e-12));
        assert.ok(cerca(velocidad, (curva.velocidades[2] + curva.velocidades[3]) / 2, 1e-12));
    });

    test('antes de empezar, el principio; pasado el final, el destino y quieta', () => {
        assert.deepEqual(enInstante(curva, -50), { valor: 0, velocidad: curva.velocidades[0] });
        assert.deepEqual(enInstante(curva, curva.durationMs + 500), { valor: 1, velocidad: 0 });
    });
});

describe('animarCurva y muelleEnCompositor', () => {
    test('un fotograma clave por valor, lineal, y se queda en el último', () => {
        const el = elementoFalso();
        const curva = curvaDesde();
        animarCurva(el, curva, (p) => ({ opacity: p }));
        const [{ fotogramas, opciones }] = el.animaciones;
        assert.equal(fotogramas.length, curva.valores.length);
        assert.deepEqual(fotogramas[0], { opacity: 0, offset: 0 });
        assert.deepEqual(fotogramas.at(-1), { opacity: 1, offset: 1 });
        assert.deepEqual(opciones, { duration: curva.durationMs, easing: 'linear', fill: 'forwards' });
    });

    test('sin Web Animations no anima nada: lo hace Spring', () => {
        assert.equal(animarCurva({ style: {} }, curvaDesde(), () => ({})), null);
        assert.equal(muelleEnCompositor([{ el: { style: {} }, fotograma: () => ({}) }], { desde: 0, hasta: 1 }), null);
    });

    test('dice dónde va, cuándo llega y lo quita todo', async () => {
        const a = elementoFalso(), b = elementoFalso();
        const m = muelleEnCompositor([{ el: a, fotograma: (x) => ({ transform: `scale(${x})` }) }, { el: b, fotograma: (x) => ({ opacity: x }) }],
            { desde: 0.5, hasta: 1, velocidad: 1 });
        a.animaciones[0].currentTime = 100;
        const curva = curvaDesde({ desde: 0.5, hasta: 1, velocidad: 1 });
        assert.deepEqual(m.instante(), enInstante(curva, 100));
        a.animaciones[0].terminar();
        assert.equal(await m.terminada, true);
        m.quitar();
        assert.ok(a.animaciones[0].cancelada && b.animaciones[0].cancelada);
    });

    test('si se quita antes de llegar, no llegó', async () => {
        const a = elementoFalso();
        const m = muelleEnCompositor([{ el: a, fotograma: (x) => ({ opacity: x }) }], { desde: 0, hasta: 1 });
        m.quitar();
        assert.equal(await m.terminada, false);
    });
});

describe('el vuelo en el compositor', () => {
    const rect = (r) => ({ getBoundingClientRect: () => r });
    const mini = { left: 20, top: 700, width: 44, height: 44 };
    const grande = { left: 40, top: 150, width: 310, height: 310 };
    let cuerpo;

    before(() => {
        cuerpo = new Set();
        globalThis.document = {
            createElement: () => elementoFalso({ setAttribute() {}, remove() { cuerpo.delete(this); } }),
            body: { appendChild: (el) => cuerpo.add(el) },
        };
    });

    const transform = (q) => `translate(${q.tx}px, ${q.ty}px) scale(${q.sx}, ${q.sy})`;

    test('el clon y cada capa siguen la misma curva; el radio, en su propia animación', () => {
        const capa = elementoFalso();
        const v = fly({ source: rect(mini), target: rect(grande), image: 'a.jpg', capas: [{ el: capa, fotograma: (p) => ({ opacity: p }) }] });
        const [mover, esquinas] = v.clone.animaciones;
        assert.equal(v.clone.animaciones.length, 2);
        assert.equal(mover.fotogramas[0].transform, transform(flightPose(mini, grande, 0, 8, 12)));
        assert.equal(mover.fotogramas.at(-1).transform, 'translate(0px, 0px) scale(1, 1)');
        assert.ok(mover.fotogramas.every((f) => !('borderRadius' in f)), 'el radio se llevaría el transform al hilo principal');
        assert.equal(esquinas.fotogramas.at(-1).borderRadius, '12px / 12px');
        assert.equal(capa.animaciones[0].fotogramas.length, mover.fotogramas.length);
        assert.equal(capa.animaciones[0].fotogramas.at(-1).opacity, 1);
        v.retarget(1);
        assert.equal(v.clone.animaciones.length, 2, 'el mismo destino no relanza nada');
    });

    test('dar la vuelta sigue desde donde iba, con su velocidad, y termina donde se pidió', async () => {
        const capa = elementoFalso();
        const v = fly({ source: rect(mini), target: rect(grande), image: 'a.jpg', capas: [{ el: capa, fotograma: (p) => ({ opacity: p }) }] });
        const [viejo] = v.clone.animaciones;
        v.clone.animaciones.forEach((a) => { a.currentTime = 150; });
        capa.animaciones[0].currentTime = 150;
        const iba = enInstante(curvaDesde(), 150);
        assert.ok(cerca(v.progress, iba.valor));

        v.retarget(0);
        assert.equal(v.heading, 0);
        assert.ok(viejo.cancelada && capa.animaciones[0].cancelada, 'las animaciones de ida se quedan puestas');
        const [vuelta] = vivas(v.clone);
        const sigue = curvaDesde({ desde: iba.valor, hasta: 0, velocidad: iba.velocidad });
        assert.equal(vuelta.fotogramas[0].transform, transform(flightPose(mini, grande, iba.valor, 8, 12)));
        assert.equal(vuelta.fotogramas[1].transform, transform(flightPose(mini, grande, sigue.valores[1], 8, 12)));
        assert.ok(sigue.valores[1] > iba.valor, 'frenazo: perdió la velocidad que llevaba');

        viejo.terminar();
        await Promise.resolve();
        assert.ok(cuerpo.has(v.clone), 'la animación sustituida no puede dar el vuelo por terminado');

        vuelta.terminar();
        assert.equal(await v.done, 0);
        assert.equal(cuerpo.has(v.clone), false, 'el clon se quedó en pantalla');
        await Promise.resolve();
        assert.equal(vivas(v.clone).length + vivas(capa).length, 0, 'las capas no vuelven a su CSS');
    });
});

describe('volarReproductor', () => {
    const rect = (r) => ({ getBoundingClientRect: () => r });

    function escena() {
        globalThis.getComputedStyle = (el) => ({ borderTopLeftRadius: el.radio });
        const partes = [elementoFalso(), elementoFalso()];
        const fullPlayer = elementoFalso({ querySelectorAll: () => partes });
        const playerBar = elementoFalso();
        const playerThumb = { ...rect({ left: 20, top: 700, width: 44, height: 44 }), style: {}, radio: '6px' };
        const fullPlayerThumb = { ...rect({ left: 40, top: 150, width: 310, height: 310 }), style: {}, radio: '24px', src: 'g.jpg' };
        return { partes, fullPlayer, playerBar, playerThumb, fullPlayerThumb };
    }

    const ultimo = (el) => el.animaciones.at(-1).fotogramas;

    test('al abrir, el reproductor aparece, la barra se va y las piezas suben a su sitio', () => {
        const e = escena();
        const { vuelo } = volarReproductor({ ...e, abrir: true });
        assert.equal(vuelo.heading, 1);
        const fp = ultimo(e.fullPlayer);
        assert.equal(fp[0].opacity, 0);
        assert.equal(fp.at(-1).opacity, 1);
        assert.equal(ultimo(e.playerBar)[0].opacity, 1);
        assert.equal(ultimo(e.playerBar).at(-1).opacity, 0);
        for (const parte of e.partes) {
            assert.deepEqual({ ...ultimo(parte)[0], offset: undefined }, { opacity: 0, transform: 'translateY(16px)', offset: undefined });
            assert.equal(ultimo(parte).at(-1).transform, 'translateY(0px)');
        }
        assert.equal(ultimo(vuelo.clone).at(-1).borderRadius, '24px / 24px', 'el radio de la carátula grande');
        assert.equal(e.playerThumb.style.visibility, 'hidden');
        assert.equal(e.fullPlayerThumb.style.visibility, 'hidden');
    });

    test('sin Web Animations, Spring lo escribe en cada fotograma y las piezas se buscan una sola vez', async () => {
        const e = escena();
        let busquedas = 0;
        const buscar = e.fullPlayer.querySelectorAll;
        e.fullPlayer.querySelectorAll = (...args) => { busquedas++; return buscar(...args); };
        const crear = document.createElement;
        document.createElement = () => ({ style: {}, setAttribute() {}, remove() {} });
        let ahora = 0;
        const cola = new Map();
        let sig = 1;
        Object.assign(scheduler, { now: () => ahora, request: (cb) => { cola.set(sig, cb); return sig++; }, cancel: (id) => cola.delete(id) });
        try {
            const { vuelo, limpiar } = volarReproductor({ ...e, abrir: true });
            const opacidades = [];
            while (cola.size) {
                ahora += 1000 / 60;
                const p = [...cola.values()]; cola.clear(); p.forEach((cb) => cb(ahora));
                opacidades.push(Number(e.fullPlayer.style.opacity));
            }
            assert.equal(await vuelo.done, 1);
            assert.ok(opacidades.length > 20 && opacidades.at(-1) === 1, 'no se escribió fotograma a fotograma');
            assert.equal(e.partes[0].style.transform, 'translateY(0px)');
            assert.equal(e.playerBar.style.opacity, '0');
            assert.equal(busquedas, 1, 'las piezas se buscan en cada fotograma');
            limpiar();
            assert.equal(e.playerBar.style.opacity, '');
        } finally {
            document.createElement = crear;
        }
    });

    test('la sombra que respira: el filtro del CSS en cada valor, mezclando sus dos extremos', () => {
        // Lo que calcularía el CSS del móvil con cada --art-shadow
        const filtro = (s) => `drop-shadow(rgba(0, 0, 0, ${0.3 + 0.4 * s}) 0px ${8 + 16 * s}px ${9 + 15 * s}px)`;
        const caratula = { style: { props: { '--art-shadow': '0.5' }, getPropertyValue(n) { return this.props[n] ?? ''; }, setProperty(n, v) { this.props[n] = v; } } };
        globalThis.getComputedStyle = (el) => ({ filter: filtro(Number(el.style.props['--art-shadow'])) });
        const fotograma = sombraQueRespira(caratula, (v) => (v - 0.82) / 0.18);
        assert.equal(caratula.style.props['--art-shadow'], '0.5', 'deja --art-shadow como estaba');
        assert.deepEqual(fotograma(1), { filter: filtro(1) });
        assert.deepEqual(fotograma(0.82), { filter: filtro(0) });
        assert.deepEqual(fotograma(0.91), { filter: 'drop-shadow(rgba(0, 0, 0, 0.5) 0px 16px 16.5px)' });
    });

    test('al cerrar va al revés, y limpiar lo deja todo en su CSS', () => {
        const e = escena();
        const { vuelo, limpiar } = volarReproductor({ ...e, abrir: false });
        assert.equal(vuelo.heading, 0);
        assert.equal(ultimo(e.fullPlayer).at(-1).opacity, 0);
        Object.assign(e.partes[0].style, { opacity: '0.4', transform: 'translateY(3px)' });
        e.fullPlayer.style.opacity = '0.5';
        limpiar();
        assert.deepEqual(e.partes[0].style, { opacity: '', transform: '' });
        assert.equal(e.fullPlayer.style.opacity, '');
        assert.equal(e.playerThumb.style.visibility, '');
        assert.equal(e.fullPlayerThumb.style.visibility, '');
    });
});

describe('los botones de la pantalla completa, siempre con toques', () => {
    // Con `pointer-events: none` en .fp-hidden, el WebView se quedaba a veces
    // con ese none heredado en las piezas que anima el vuelo, aun abierto: los
    // botones dejaban de responder (reproducido en el Vivo)
    const css = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    test('oculto, el reproductor sale de la pantalla y no quita los toques a lo de dentro', () => {
        const reglas = [...css.matchAll(/([^{}]*\.fp-hidden[^{}]*)\{([^{}]*)\}/g)];
        assert.ok(reglas.some(([, sel, cuerpo]) => sel.includes('.full-player.fp-hidden') && /transform:\s*translateY\(100%\)/.test(cuerpo)));
        for (const [, sel, cuerpo] of reglas) assert.doesNotMatch(cuerpo, /pointer-events/, `${sel.trim()} vuelve a quitar los toques`);
    });
});
