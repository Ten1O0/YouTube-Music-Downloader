/**
 * Guardas `globalThis.X` sobre identificadores que nunca llegan a globalThis.
 *
 * Este defecto ha aparecido ya cinco veces en app.js y siempre igual: se
 * protege una llamada con `if (globalThis.Algo !== undefined)`, pero `Algo`
 * está declarado con `const` en el nivel superior del script. A diferencia de
 * `var` y de las funciones declaradas, `const`, `let` y `class` NO crean una
 * propiedad en el objeto global, así que la condición es siempre falsa y el
 * código de dentro no se ejecuta jamás.
 *
 * Lo peor es que no hay error en consola: la aplicación funciona, simplemente
 * le falta un trozo. Así se perdieron el corazón de favoritos, el refresco de
 * la vista de favoritos, el botón atrás del modal de permisos y —el que llevó
 * a escribir este fichero— la tarjeta flotante de progreso de descarga, que no
 * aparecía nunca ni en escritorio ni en móvil pese a tener todo su CSS bien.
 *
 * El test es de análisis estático a propósito: no depende de que alguien se
 * acuerde de probar la interfaz.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');

/**
 * Identificadores declarados en el nivel superior con const/let/class.
 * Se reconocen porque empiezan en la columna 0: dentro de una función irían
 * indentados, y esos no compiten por el objeto global.
 */
function declaracionesDeNivelSuperior(fuente) {
    const nombres = new Set();
    const re = /^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(fuente)) !== null) nombres.add(m[1]);
    return nombres;
}

/** Cada `globalThis.X` que aparece en el código, con su número de línea. */
function usosDeGlobalThis(fuente) {
    const usos = [];
    fuente.split('\n').forEach((linea, i) => {
        // Los comentarios explican precisamente este defecto: no cuentan.
        const codigo = linea.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        for (const m of codigo.matchAll(/globalThis\.([A-Za-z_$][\w$]*)/g)) {
            usos.push({ nombre: m[1], linea: i + 1 });
        }
    });
    return usos;
}

/**
 * Defectos ya conocidos y todavía sin decidir qué hacer con ellos.
 *
 * `auth` es el mismo caso: `const auth = new AuthManager()`, así que la
 * sincronización de favoritos e historial con el servidor no llega a
 * ejecutarse nunca. Arreglarlo no es un cambio visual —haría que la
 * aplicación empiece a escribir en el servidor datos que hoy solo viven en el
 * navegador—, así que se deja apuntado aquí en vez de cambiarlo de tapadillo.
 *
 * Esta lista solo debe encoger. Si crece, es que el defecto ha vuelto.
 */
const PENDIENTES = new Set(['auth']);

describe('guardas sobre el objeto global', () => {
    const declarados = declaracionesDeNivelSuperior(FUENTE);
    const usos = usosDeGlobalThis(FUENTE);

    test('const/let/class de nivel superior no se consultan vía globalThis', () => {
        const rotos = usos.filter(
            (u) => declarados.has(u.nombre) && !PENDIENTES.has(u.nombre)
        );

        const detalle = rotos
            .map((u) => `  app.js:${u.linea}  globalThis.${u.nombre} (declarado como const/let/class: siempre undefined)`)
            .join('\n');

        assert.equal(rotos.length, 0,
            `hay ${rotos.length} guarda(s) que nunca se cumplen:\n${detalle}`);
    });

    test('queueManager se invoca directamente, sin guarda', () => {
        // Es el caso concreto que dejaba sin tarjeta de progreso a la interfaz.
        assert.ok(!FUENTE.includes('globalThis.queueManager'),
            'volvió la guarda: la tarjeta de progreso no se mostrará');
        assert.ok(FUENTE.includes('queueManager.add('),
            'nadie da de alta descargas en el panel');
    });

    test('lo que sí viene del entorno se sigue comprobando con globalThis', () => {
        // Capacitor lo inyecta el contenedor nativo como propiedad global de
        // verdad, así que ahí la guarda es correcta y debe permanecer.
        assert.ok(FUENTE.includes('globalThis.Capacitor'),
            'la detección de la app nativa debe seguir usando globalThis');
        assert.ok(!declarados.has('Capacitor'),
            'Capacitor no puede declararse en app.js: lo aporta el entorno');
    });

    test('la lista de pendientes no crece sin darse cuenta', () => {
        for (const nombre of PENDIENTES) {
            assert.ok(declarados.has(nombre),
                `${nombre} ya no es const de nivel superior: quítalo de PENDIENTES`);
        }
        assert.ok(PENDIENTES.size <= 1,
            `hay ${PENDIENTES.size} defectos conocidos sin resolver`);
    });
});
