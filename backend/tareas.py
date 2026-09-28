"""
Tareas del servidor que corren fuera de gunicorn (plan 14).

    python tareas.py comprobar_listas

Lo lanza cada hora un temporizador de systemd (scripts/servidor/
instalar-comprobar-listas.sh), con un candado para no solaparse. No importa
server.py: arrancar el servidor vaciaría la carpeta de las descargas en curso.
"""

import sys
import time

import database as db
from listas_youtube import ListaNoDisponible, leer_lista

PAUSA_ENTRE_LISTAS = 5


def comprobar_listas(leer=leer_lista, pausa=PAUSA_ENTRE_LISTAS, dormir=time.sleep):
    """Lee, de una en una, las listas seguidas que tocan y apunta lo nuevo. Devuelve un resumen."""
    resumen = {'comprobadas': 0, 'nuevas': 0, 'fallidas': 0}
    for i, fila in enumerate(db.listas_por_comprobar()):
        if i:
            dormir(pausa)
        try:
            resultado = leer(fila['list_id'])
        except ListaNoDisponible as e:
            print(f"[comprobar_listas] {fila['list_id']}: no disponible ({e})")
            db.apuntar_comprobacion(fila['user_id'], fila['list_id'], None)
            resumen['fallidas'] += 1
            continue
        resumen['nuevas'] += db.apuntar_comprobacion(fila['user_id'], fila['list_id'], resultado)
        resumen['comprobadas'] += 1
    return resumen


if __name__ == '__main__':
    if sys.argv[1:] != ['comprobar_listas']:
        print('Uso: python tareas.py comprobar_listas')
        sys.exit(2)
    db.init_db()
    print(f'[comprobar_listas] {comprobar_listas()}')
