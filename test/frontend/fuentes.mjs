/**
 * Rutas del proyecto para los tests que leen el código como texto.
 *
 * El cliente ya no es un único app.js: está repartido en módulos bajo
 * frontend/src/. codigoCliente() los junta para que una comprobación sobre
 * «el código de la app» no dependa de en qué fichero haya acabado cada cosa.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = path.join(RAIZ, 'frontend', 'src');

/** Lee un fichero por su ruta desde la raíz del repositorio. */
export const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

/** Todos los .js de frontend/src, recorridos en orden estable. */
export function ficherosCliente(dir = SRC) {
    return fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((e) => {
            const ruta = path.join(dir, e.name);
            if (e.isDirectory()) return e.name === 'pages' ? [] : ficherosCliente(ruta);
            return e.name.endsWith('.js') ? [ruta] : [];
        });
}

/** El código de la app (sin la página de descarga), como un solo texto. */
export const codigoCliente = () => ficherosCliente().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
