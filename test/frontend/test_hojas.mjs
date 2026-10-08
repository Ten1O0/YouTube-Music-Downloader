/**
 * Hojas, alertas y foco de los modales (plan 09, T17).
 *
 * Lo que se fija: a dónde va el foco y cómo se mueve con Tab, cuándo el dedo
 * arrastra la hoja y cuándo el scroll de dentro, y que cerrar sea siempre «lo
 * que haría el usuario», para que cada modal ejecute su propia lógica.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    siguienteFoco, primerControl, puedeArrastrar, cerrarComoUsuario, esAlerta, zIndexAlAbrir,
} from '../../frontend/src/ui/sheets.js';
import { codigoCliente, leer } from './fuentes.mjs';

const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Un control de mentira: basta con saber a qué selectores responde. */
function control(nombre, selectores = []) {
    return { nombre, matches: sel => selectores.some(s => sel.includes(s)) };
}

describe('foco', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(n => control(n));

    test('Tab da la vuelta sin salir del modal', () => {
        assert.equal(siguienteFoco([a, b, c], a), b);
        assert.equal(siguienteFoco([a, b, c], c), a);
        assert.equal(siguienteFoco([a, b, c], a, true), c);
    });

    test('si el foco está fuera, entra por el principio o por el final', () => {
        assert.equal(siguienteFoco([a, b, c], null), a);
        assert.equal(siguienteFoco([a, b, c], null, true), c);
        assert.equal(siguienteFoco([], null), null);
    });

    test('al abrir va al primer control que no sea la X', () => {
        const x = control('x', ['.auth-modal-close']);
        const crear = control('crear');
        assert.equal(primerControl([x, crear]), crear);
        assert.equal(primerControl([x]), x, 'si solo está la X, a la X');
    });

    test('en táctil no abre el teclado por su cuenta', () => {
        const x = control('x', ['.auth-modal-close']);
        const campo = control('campo', ['input:not(']);
        assert.equal(primerControl([x, campo], { tactil: true }), null);
        assert.equal(primerControl([x, campo], { tactil: false }), campo);
    });
});

describe('arrastrar para cerrar', () => {
    function arbol(scrollDentro) {
        const panel = { scrollTop: 0, closest: () => null };
        panel.parentElement = { scrollTop: 0 };
        const lista = { scrollTop: scrollDentro, parentElement: panel, closest: () => null };
        const fila = { scrollTop: 0, parentElement: lista, closest: () => null };
        return { panel, fila };
    }

    test('con el contenido arriba del todo, el gesto es de la hoja', () => {
        const { panel, fila } = arbol(0);
        assert.ok(puedeArrastrar(fila, panel));
    });

    test('con una lista desplazada, el gesto es de la lista', () => {
        const { panel, fila } = arbol(120);
        assert.ok(!puedeArrastrar(fila, panel));
    });

    test('desde el asa, siempre', () => {
        const { panel } = arbol(120);
        const asa = { scrollTop: 0, closest: sel => (sel.includes('.hoja-asa') ? asa : null), parentElement: panel };
        assert.ok(puedeArrastrar(asa, panel));
    });
});

describe('cerrar como el usuario', () => {
    function modal({ x = false, fondo = true } = {}) {
        const pulsados = [];
        const boton = n => ({ click: () => pulsados.push(n) });
        return {
            pulsados,
            querySelector: sel => (sel.includes('.auth-modal-close') ? (x ? boton('x') : null)
                : sel.includes('.auth-modal-backdrop') && fondo ? boton('fondo') : null),
        };
    }

    test('con la X de ese modal, si la tiene', () => {
        const m = modal({ x: true });
        cerrarComoUsuario(m);
        assert.deepEqual(m.pulsados, ['x']);
    });

    test('si no, con su fondo: así las alertas resuelven como «Cancelar»', () => {
        const m = modal();
        cerrarComoUsuario(m);
        assert.deepEqual(m.pulsados, ['fondo']);
    });
});

describe('clasificación y estilos', () => {
    const HTML = leer('frontend/index.html');

    test('las confirmaciones son alertas; el resto, hojas', () => {
        const alertas = [...HTML.matchAll(/<div id="(\w+)" class="auth-modal modal-alerta hidden"/g)].map(m => m[1]).sort();
        // confirmModal: la pregunta genérica del plan 13 (ui/confirm.js)
        assert.deepEqual(alertas, ['confirmModal', 'customAlertModal', 'logoutConfirmModal', 'playlistDeleteConfirmModal']);
        assert.ok(esAlerta({ classList: { contains: c => c === 'modal-alerta' } }));
    });

    test('en el móvil, las hojas se anclan abajo y entran desde abajo', () => {
        assert.match(CSS, /\.auth-modal:not\(\.modal-alerta\)\s*\{[^}]*align-items:\s*flex-end/);
        assert.match(CSS, /\.auth-modal\.hidden:not\(\.modal-alerta\) \.auth-modal-content\s*\{[^}]*translateY\(100%\)/);
        assert.match(CSS, /\.auth-modal\.modal-alerta\.hidden \.auth-modal-content\s*\{[^}]*scale\(0\.92\)/);
    });

    test('en el escritorio, fondo desenfocado 8 px', () => {
        assert.match(CSS, /@media \(min-width: 768px\)\s*\{\s*\.auth-modal-backdrop,\s*\.pq-backdrop\s*\{[^}]*blur\(8px\)/);
    });

    test('mientras la lleva el dedo, nada de transiciones', () => {
        assert.match(CSS, /\[data-arrastre="siguiendo"\][^{]*\{[^}]*transition:\s*none !important/);
    });

    test('con «Reducir movimiento», las hojas se funden sin desplazarse', () => {
        const bloques = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
        assert.match(bloques, /\.auth-modal\.hidden:not\(\.modal-alerta\) \.auth-modal-content[\s\S]*?transform:\s*none/);
    });
});

describe('pila de modales', () => {
    const APP = codigoCliente();

    test('atrás cierra el modal de arriba, no el primero del DOM', () => {
        assert.match(APP, /const openModal = modales\.arriba\(\)\?\.matches\('\.auth-modal'\)/);
    });

    test('Escape en el reproductor cede ante un modal abierto encima', () => {
        assert.match(APP, /e\.key === 'Escape' && !e\.defaultPrevented && fullPlayer[^\n]*!modales\.arriba\(\)/);
        // Y si el modal ya se ha cerrado con ese mismo Escape, tampoco (plan 21, T5)
        assert.match(APP, /if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);/);
    });
});

describe('el que se abre después, encima (plan 21, T2)', () => {
    test('una hoja abierta desde otra queda por encima, aunque compartan z-index', () => {
        // Ajustes (5000) abierta; se abre «Cerrar sesión» (5000), que va antes en el HTML
        assert.equal(zIndexAlAbrir(5000, [5000]), 5001);
        // Y una tercera, encima de las dos
        assert.equal(zIndexAlAbrir(5000, [5000, 5001]), 5002);
    });

    test('sin nada abierto, o por debajo, conserva el suyo', () => {
        assert.equal(zIndexAlAbrir(5000, []), 5000);
        assert.equal(zIndexAlAbrir(5000, [2000]), 5000);
    });

    test('nunca baja el suyo: la alerta propia sigue en 99999', () => {
        assert.equal(zIndexAlAbrir(99999, [5000, 5001]), 99999);
    });

    test('la pila lo aplica al abrir y lo devuelve al cerrar', () => {
        const APP = codigoCliente();
        assert.match(APP, /pila\.push\(modal\);\s*subir\(modal\);/);
        assert.match(APP, /pila\.splice\(pila\.indexOf\(modal\), 1\);\s*bajar\(modal\);/);
    });
});
