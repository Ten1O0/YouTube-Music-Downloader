/**
 * Textos de la interfaz en los seis idiomas, uno por fichero en translations/.
 * Las claves de todos deben coincidir: lo comprueba test_i18n.
 *
 * La app no importa este fichero: el castellano va dentro de
 * language-manager.js y cada uno de los otros se carga al elegirlo (plan 19,
 * T11). Lo usan los tests, que necesitan los seis a la vez.
 */

import es from './translations/es.js';
import en from './translations/en.js';
import fr from './translations/fr.js';
import de from './translations/de.js';
import pt from './translations/pt.js';
import zh from './translations/zh.js';

export const TRANSLATIONS = { es, en, fr, de, pt, zh };
