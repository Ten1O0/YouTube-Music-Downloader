# 🎵 YouTube Downloader

Una aplicación web moderna y elegante para descargar música de YouTube como archivos MP3 de alta calidad.

![YouTube Downloader](https://img.shields.io/badge/YouTube-Downloader-red?style=for-the-badge&logo=youtube)
![Python](https://img.shields.io/badge/Python-3.8+-blue?style=for-the-badge&logo=python)
![Flask](https://img.shields.io/badge/Flask-2.0+-green?style=for-the-badge&logo=flask)

## ✨ Características

### 🔗 Múltiples formas de descargar
- **URL directa**: Pega cualquier enlace de YouTube (videos, shorts, música)
- **Playlists completas**: Descarga listas de reproducción enteras como ZIP
- **Búsqueda por nombre**: Busca canciones por título y elige entre los resultados

### 🎨 Interfaz moderna
- Diseño dark mode elegante con gradientes y animaciones
- Miniaturas y vista previa de resultados de búsqueda
- Barra de progreso en tiempo real
- Totalmente responsive (móvil y escritorio)

### 🚀 Rendimiento
- Descarga en segundo plano sin bloquear la interfaz
- Conversión automática a MP3 de alta calidad
- Soporte para playlists de cualquier tamaño

## 📋 Requisitos

- **Python 3.8** o superior
- **FFmpeg** (incluido en el proyecto para Windows)
- Conexión a internet

## 🛠️ Instalación

### 1. Clonar o descargar el proyecto

```bash
git clone https://github.com/tu-usuario/youtube-downloader.git
cd youtube-downloader
```

### 2. Crear entorno virtual (recomendado)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/Mac
source .venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Verificar FFmpeg

El proyecto incluye FFmpeg para Windows. Si estás en Linux/Mac, instálalo:

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Mac (con Homebrew)
brew install ffmpeg
```

## 🚀 Uso

### Iniciar el servidor

```bash
python server.py
```

El servidor se iniciará en `http://localhost:5000`

### Abrir la aplicación

1. Abre tu navegador
2. Ve a `http://localhost:5000`
3. ¡Listo para descargar!

## 📖 Guía de uso

### Descargar un video específico

1. Copia la URL del video de YouTube
2. Pégala en el campo de entrada
3. Haz clic en "Descargar"
4. El archivo MP3 se descargará automáticamente

### Descargar una playlist completa

1. Copia la URL de la playlist (o de un video dentro de ella)
2. Pégala en el campo de entrada
3. Haz clic en "Descargar"
4. Verás el progreso de cada canción
5. Se descargará un archivo ZIP con todas las canciones

### Buscar por nombre

1. Escribe el nombre de la canción o artista
2. Haz clic en "Descargar"
3. Aparecerán 5 resultados con miniaturas
4. Haz clic en el que desees descargar

## 📁 Estructura del proyecto

```
YouTube Downloader/
├── server.py           # Backend Flask
├── index.html          # Página principal
├── styles.css          # Estilos CSS
├── app.js              # Lógica del frontend
├── requirements.txt    # Dependencias Python
└── ffmpeg-master-latest-win64-gpl/
    └── bin/            # FFmpeg para Windows
```

## 🔧 API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Página principal |
| GET | `/api/health` | Estado del servidor |
| POST | `/api/search` | Buscar videos en YouTube |
| POST | `/api/start-download` | Iniciar descarga |
| GET | `/api/progress/<id>` | Obtener progreso de descarga |
| GET | `/api/download/<id>` | Descargar archivo completado |

## ⚙️ Configuración

Las variables principales se pueden modificar en `server.py`:

```python
DOWNLOAD_TIMEOUT = 1800  # Timeout en segundos (30 min)
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')
```

## 🐛 Solución de problemas

### "No se puede conectar al servidor"
- Verifica que el servidor esté corriendo (`python server.py`)
- Asegúrate de que el puerto 5000 no esté en uso

### "Error al descargar"
- Verifica tu conexión a internet
- Algunos videos pueden tener restricciones geográficas
- Actualiza yt-dlp: `pip install --upgrade yt-dlp`

### La descarga tarda mucho
- Las playlists grandes pueden tardar varios minutos
- El progreso se muestra en tiempo real

## 📦 Dependencias

| Paquete | Versión | Uso |
|---------|---------|-----|
| Flask | ≥2.0 | Framework web |
| Flask-CORS | ≥3.0 | Permitir peticiones cross-origin |
| yt-dlp | Latest | Descarga de YouTube |

## 🔒 Aviso legal

Esta herramienta está diseñada únicamente para uso personal y educativo. Respeta los derechos de autor y los términos de servicio de YouTube. No utilices esta herramienta para:

- Descargar contenido protegido por derechos de autor sin permiso
- Redistribuir contenido descargado comercialmente
- Violar los términos de servicio de YouTube

## 🤝 Contribuir

Las contribuciones son bienvenidas. Para cambios importantes:

1. Haz fork del repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo `LICENSE` para más detalles.

---

<p align="center">
  Hecho con ❤️ usando Python y Flask
</p>
