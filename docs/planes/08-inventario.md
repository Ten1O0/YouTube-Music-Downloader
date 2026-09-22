# Inventario de dependencias de `app.js` (plan 08, T1)

Documento temporal: desaparece cuando el plan 08 se cierre.

Medido el 2026-09-22 sobre `app.js` (7.854 líneas tras T2).

## Módulos y tamaño

| Módulo | Líneas | Nivel propuesto |
|---|---:|---|
| `PlaylistModule` | 812 | 4 |
| `PlayerModule` | 805 | 4 |
| `LibraryModule` | 262 | 3 |
| `LyricsModule` | 244 | 4 |
| `FavoritesModule` | 168 | 3 |
| `NavigationModule` | 162 | 6 |
| `OnboardingModule` | 127 | 6 |
| `NativeMediaSession` | 122 | 2 |
| `StorageModule` | 89 | 1 |
| `AudioUrlCache` | 38 | 2 |

Más **126 funciones sueltas** de nivel superior.

## Grafo de dependencias

```
StorageModule        -> (nada)
AudioUrlCache        -> (nada)
NativeMediaSession   -> (nada)
OnboardingModule     -> NavigationModule
LyricsModule         -> PlayerModule
NavigationModule     -> PlayerModule
FavoritesModule      -> LibraryModule, PlayerModule, PlaylistModule, StorageModule
LibraryModule        -> FavoritesModule, PlayerModule, PlaylistModule, StorageModule
PlaylistModule       -> FavoritesModule, LibraryModule, NavigationModule, PlayerModule, StorageModule
PlayerModule         -> FavoritesModule, LibraryModule, LyricsModule, NativeMediaSession, NavigationModule
```

## ⚠️ Ciclos: 66

El plan §2.4 anticipaba tres módulos enredados. Son **cinco**, y forman un
grafo completo entre sí:

```
        ┌─────────────────────────────────────┐
        │                                     │
  FavoritesModule ←→ LibraryModule ←→ PlaylistModule
        ↕                 ↕                 ↕
        └───────→ PlayerModule ←────────────┘
                       ↕
                NavigationModule
```

Los cuatro ciclos de dos nodos son los que hay que romper primero:

| Ciclo | Cómo romperlo |
|---|---|
| `Favorites ↔ Library` | `Library` solo necesita `isFavorite()` para pintar el corazón → bajar el estado de favoritos a nivel 2 |
| `Favorites ↔ Player` | `Player` llama a `updateFavBtn()` → bus de eventos `song:changed` |
| `Favorites ↔ Playlist` | Mismo caso que Library |
| `Library ↔ Player` | `Player` llama a `LibraryModule.setPlaying()` → bus de eventos |
| `Navigation ↔ Player` | `Navigation` cierra el reproductor a pantalla completa → bus de eventos |

**Conclusión del inventario:** sin un bus de eventos (§2.4) no hay orden de
extracción que funcione. Debe ser lo primero del nivel 0, antes que cualquier
otro módulo.

## Código muerto (T2) — ya eliminado

| Función | Líneas | Nota |
|---|---:|---|
| `downloadBlobAndSave` + `_origDownloadBlob` | 93 | Sin llamantes. **Ver abajo** |
| `extractLocalMetadata` | 26 | Sin llamantes; `jsmediatags` se sigue usando en otros cinco sitios |

### 🔴 Lo que apareció al revisar `downloadBlobAndSave`

Esa función no tenía **ningún** llamante, y era donde el plan 01 (T8) escribió
la persistencia del audio en IndexedDB. Es decir: **ese arreglo nunca llegó a
ejecutarse.**

El camino web real es `saveDownloadToApp`, y su rama de navegador hacía:

```js
setTimeout(() => { globalThis.location.href = downloadUrl; }, 500);
```

Devolviendo `streamUrl = /api/stream/<download_id>`, que es lo que acababa en
`src` de la biblioteca. Y ese recurso es **temporal**: el servidor borra la
carpeta en el `call_on_close` de `/api/download/<id>`, que es justo lo que
dispara ese `location.href`.

Resultado: en navegador, **toda canción descargada quedaba inservible casi al
instante**, no solo al recargar. El defecto D1 del plan 01 era peor de lo
diagnosticado y seguía abierto.

**Corregido** conectando el camino real: `saveDownloadToBrowser()` descarga el
blob, lo persiste en IndexedDB, devuelve `idb://<id>` y entrega el fichero al
usuario desde el mismo blob. Son dos cosas distintas y ahora están separadas.
