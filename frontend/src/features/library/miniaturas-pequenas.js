/**
 * Las miniaturas pequeñas de lo que ya estaba guardado (tras la 2.1.1).
 *
 * Desde ahora, una carátula grande se guarda con una miniatura pequeña aparte
 * (core/miniaturas.js). Lo importado antes solo tiene la grande, y la
 * Biblioteca la descomprime entera por cada fila: el scroll iba a tirones los
 * primeros segundos. Una vez, en segundo plano y con turno, cada canción con
 * carátula grande recibe su miniatura; la grande se queda como `caratula`.
 *
 * Las copias de las canciones en las listas comparten fichero con la de la
 * biblioteca: se ponen al día por su ruta.
 */

import { reducirMiniaturas } from '../../core/miniaturas.js';
import { StorageModule } from '../../core/storage.js';
import { esperarTurno, PRIORIDAD } from '../../ui/tareas.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { LibraryModule } from './library.js';

/** Al arrancar la APK, sin prisa: y si ha cambiado algo, la biblioteca y las listas se repintan una vez, con turno. */
export async function reducirMiniaturasAlArrancar() {
    const { hechas } = await reducirMiniaturas({
        almacen: StorageModule, getLibrary: LibraryModule.getLibrary, saveLibrary: LibraryModule.saveLibrary,
        leerListas: getPlaylists, guardarListas: savePlaylists, turno: () => esperarTurno(PRIORIDAD.baja),
    });
    if (!hechas) return;
    await esperarTurno(PRIORIDAD.baja);
    await LibraryModule.render({ animar: false });
    await PlaylistModule.renderGrid();
}
