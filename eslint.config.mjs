/**
 * ESLint: solo reglas que detectan fallos, no estilo.
 *
 * - no-undef: una llamada a algo que no existe en ese ámbito. Así se rompieron
 *   las playlists durante meses (nueve llamadas a funciones de PlaylistModule
 *   sin su prefijo) sin que node --check ni los tests lo vieran. Con el cliente
 *   en módulos (plan 08) cada fichero tiene su ámbito, así que esta regla
 *   sustituye al test que lo buscaba con expresiones regulares.
 * - no-dupe-keys: la misma clave dos veces en un objeto; la segunda pisa a la
 *   primera en silencio (pasó con una traducción).
 * - no-unreachable: código que nunca se ejecuta.
 * - no-unused-vars: variables y funciones que nadie usa. Con todo el cliente en
 *   un solo fichero no se veían; al partirlo en módulos (plan 08) aparecieron
 *   trece, entre ellas un modal de ordenar listas que ya nada abría.
 */
import globals from 'globals';

const reglas = {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }],
};

export default [
    // Generado o de terceros
    { ignores: ['dist/**', 'mobile/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'frontend/public/Sortable.min.js'] },
    {
        files: ['frontend/src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            // Sortable, jsmediatags y google llegan por <script> en index.html
            globals: { ...globals.browser, Sortable: 'readonly', jsmediatags: 'readonly', google: 'readonly' },
        },
        rules: reglas,
    },
    {
        files: ['frontend/public/sw.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker },
        rules: reglas,
    },
    {
        files: ['scripts/**/*.mjs', 'vite.config.js', 'playwright.config.js', 'eslint.config.mjs', 'test/**/*.mjs', 'test/**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: reglas,
    },
];
