/**
 * La zona para soltar el fichero de Importar (plan 23, D6).
 *
 * En lugar del selector del navegador («Choose File · No file chosen», en
 * inglés aunque la app no lo esté): una zona que se toca para elegir o sobre la
 * que se suelta el fichero, y que enseña el nombre del elegido. Por dentro
 * sigue el mismo <input type="file">: soltar un fichero lo pone en él y avisa
 * con un `change`, así que import.js lo lee igual que antes.
 */

import { i18n } from '../../i18n/language-manager.js';

/**
 * Engancha la zona a su <input type="file">. Devuelve `limpiar()`, para
 * cuando la hoja vuelve a empezar.
 */
export function initZonaFichero({ zona, entrada, nombre }) {
    if (!zona || !entrada) return { limpiar() {} };

    const pintarNombre = () => {
        const fichero = entrada.files?.[0];
        zona.classList.toggle('import-zona--elegido', Boolean(fichero));
        if (nombre) {
            nombre.hidden = !fichero;
            nombre.textContent = fichero ? fichero.name : '';
        }
        zona.setAttribute('aria-label', fichero ? `${i18n.t('import_file_drop')} · ${fichero.name}` : i18n.t('import_file_drop'));
    };
    entrada.addEventListener('change', pintarNombre);

    // Arrastrar encima: se marca la zona y el navegador no abre el fichero
    let dentro = 0;
    const marcar = (si) => zona.classList.toggle('import-zona--encima', si);
    zona.addEventListener('dragenter', (e) => { e.preventDefault(); dentro++; marcar(true); });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    zona.addEventListener('dragleave', () => { dentro = Math.max(0, dentro - 1); if (!dentro) marcar(false); });
    zona.addEventListener('drop', (e) => {
        e.preventDefault();
        dentro = 0;
        marcar(false);
        const ficheros = e.dataTransfer?.files;
        if (!ficheros?.length) return;
        entrada.files = ficheros;
        entrada.dispatchEvent(new Event('change', { bubbles: true }));
    });

    pintarNombre();
    return {
        limpiar() {
            entrada.value = '';
            pintarNombre();
        },
    };
}
