/**
 * Los botones y el arrastrar de importar audio, en el arranque. El importador
 * (importer.js) se carga al elegir los ficheros (plan 24): el arranque estaba
 * en el límite de su presupuesto. El selector de ficheros se abre en el mismo
 * toque, sin esperar a nada, o el navegador no lo dejaría abrirse.
 */

import { isNative } from '../../config/env.js';
import { i18n } from '../../i18n/language-manager.js';

const cargar = () => import('./importer.js');

/** En el ordenador: soltar ficheros sobre la Biblioteca los importa. */
function initArrastrar() {
    const vista = document.getElementById('libraryView');
    if (!vista || isNative()) return;
    const conFicheros = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    let dentro = 0;
    const salir = () => { dentro = 0; vista.classList.remove('soltando'); };
    vista.addEventListener('dragenter', (e) => {
        if (!conFicheros(e)) return;
        e.preventDefault();
        dentro++;
        vista.dataset.soltar = i18n.t('import_drop');
        vista.classList.add('soltando');
    });
    vista.addEventListener('dragover', (e) => { if (conFicheros(e)) e.preventDefault(); });
    vista.addEventListener('dragleave', () => { if (--dentro <= 0) salir(); });
    vista.addEventListener('drop', (e) => {
        if (!conFicheros(e)) return;
        e.preventDefault();
        salir();
        const ficheros = e.dataTransfer.files;
        cargar().then((m) => m.importarFicheros(ficheros)).catch((err) => console.error('[Importar]', err));
    });
}

export function setupNativeImporter() {
    const importBtn = document.getElementById('importAudioBtn');
    const importInput = document.getElementById('importAudioInput');
    if (importBtn === null || importInput === null) return;

    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        importInput.value = '';
        await (await cargar()).importarFicheros(files);
    });
    initArrastrar();

    // «Sincronizar» (APK): el escaneo se carga al pulsarlo (plan 25)
    document.getElementById('syncLibraryBtn')?.addEventListener('click', () => {
        import('./recovery.js').then((m) => m.scanPublicFolder(false)).catch((e) => console.error('[Sincronizar]', e));
    });
}
