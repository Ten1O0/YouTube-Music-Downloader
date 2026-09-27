/**
 * Sesiones de prueba sin pasar por Google (plan 13): el usuario se crea en la
 * base de datos del servidor de los recorridos y el token se firma con el
 * mismo secreto que le da playwright.config.js.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

const SECRETO = process.env.E2E_JWT_SECRET ?? 'secreto-solo-para-e2e';

/** El usuario con ese email, creado si no existe. Devuelve su fila. */
export function usuarioDePrueba(email, dir = path.resolve('test/e2e/.tmp-data')) {
    const guion = [
        'import json, sqlite3, sys',
        'con = sqlite3.connect(sys.argv[1])',
        "con.execute(\"INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)\", (sys.argv[2], sys.argv[2].split('@')[0]))",
        'con.commit()',
        "fila = con.execute('SELECT id, email, name FROM users WHERE email = ?', (sys.argv[2],)).fetchone()",
        "print(json.dumps({'id': fila[0], 'email': fila[1], 'name': fila[2], 'picture': ''}))",
    ].join('\n');
    return JSON.parse(execFileSync('python3', ['-c', guion, path.join(dir, 'youtube_downloader.db'), email]).toString());
}

const b64url = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

/** Un JWT HS256 como el que crea create_jwt_token. */
export function tokenDe(userId, { horas = 1 } = {}) {
    const ahora = Math.floor(Date.now() / 1000);
    const cuerpo = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ user_id: userId, iat: ahora, exp: ahora + horas * 3600 })}`;
    const firma = crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
    return `${cuerpo}.${firma}`;
}

/** Deja la sesión en el almacenamiento de la página y recarga para que arranque con ella. */
export async function iniciarSesionDePrueba(page, email) {
    const usuario = usuarioDePrueba(email);
    await page.evaluate(([token, user]) => {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user', JSON.stringify(user));
    }, [tokenDe(usuario.id), usuario]);
    await page.reload();
    return usuario;
}
