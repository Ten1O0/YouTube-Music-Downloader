"""
Invariantes de configuración del build y del despliegue (plan 04).

Este plan es sobre todo herramientas, y la mayoría se verifica ejecutándolas.
Lo que sí se puede blindar son las invariantes que se rompen en silencio meses
después: una dependencia sin fijar, un manifest duplicado que diverge, un
binario que vuelve al repositorio.

El test que más veces va a saltar es el del pinning: está escrito para fallar
en cuanto alguien añada una dependencia sin versión.
"""

import json
import os
import re
import subprocess

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _leer(*partes):
    with open(os.path.join(RAIZ, *partes), encoding="utf-8") as fh:
        return fh.read()


def _existe(*partes):
    return os.path.exists(os.path.join(RAIZ, *partes))


# ========================================
# T3 · Versiones fijas
# ========================================

def _dependencias():
    """Líneas reales de requirements.txt, sin comentarios ni vacías."""
    return [
        linea.strip() for linea in _leer("backend", "requirements.txt").splitlines()
        if linea.strip() and not linea.strip().startswith("#")
    ]


def test_requirements_is_not_empty():
    assert len(_dependencias()) >= 5


def test_every_dependency_is_pinned():
    """
    Sin fijar, un redeploy puede traer una versión nueva y tumbar el servicio
    sin que nadie haya tocado el código. yt-dlp es el caso típico.
    """
    sin_fijar = [d for d in _dependencias() if "==" not in d]
    assert sin_fijar == [], f"dependencias sin versión fija: {sin_fijar}"


def test_pinned_versions_look_valid():
    for dep in _dependencias():
        nombre, _, version = dep.partition("==")
        assert nombre.strip(), f"nombre vacío en: {dep}"
        assert re.fullmatch(r"[\w.\-]+", version.strip()), f"versión rara en: {dep}"


@pytest.mark.parametrize("paquete", [
    "Flask", "flask-cors", "flask-limiter", "PyJWT",
    "google-auth", "requests", "yt-dlp", "gunicorn",
])
def test_required_packages_are_listed(paquete):
    nombres = {d.partition("==")[0].strip().lower() for d in _dependencias()}
    assert paquete.lower() in nombres, f"falta {paquete} en requirements.txt"


def test_ytdlp_and_ejs_are_pinned_together():
    """
    yt-dlp-ejs es el resolutor de desafíos JS y va emparejado con yt-dlp.
    Si uno se actualiza sin el otro, la extracción se degrada en silencio:
    es lo que pasaba con yt-dlp 2026.03 y yt-dlp-ejs 0.4.0.
    """
    nombres = {d.partition("==")[0].strip().lower() for d in _dependencias()}
    assert "yt-dlp" in nombres
    assert "yt-dlp-ejs" in nombres, "yt-dlp-ejs debe fijarse junto a yt-dlp"


def test_imported_modules_are_declared():
    """Todo lo que server.py y database.py importan debe estar en requirements."""
    equivalencias = {
        "flask": "Flask", "flask_cors": "flask-cors", "flask_limiter": "flask-limiter",
        "jwt": "PyJWT", "google": "google-auth", "requests": "requests",
        "werkzeug": "Flask",   # viene con Flask
    }
    declarados = {d.partition("==")[0].strip().lower() for d in _dependencias()}

    fuente = _leer("backend", "server.py") + _leer("backend", "database.py")
    importados = set(re.findall(r"^(?:from|import)\s+([a-z_][\w]*)", fuente, re.M))

    faltan = []
    for mod in importados:
        paquete = equivalencias.get(mod)
        if paquete and paquete.lower() not in declarados:
            faltan.append(f"{mod} -> {paquete}")
    assert faltan == [], f"módulos importados sin declarar: {faltan}"


# ========================================
# T6 · Un solo manifest.json
# ========================================

def test_root_manifest_is_gone():
    """Dos manifest es el mismo problema de doble fuente de verdad del plan 01."""
    assert not _existe("manifest.json"), (
        "manifest.json volvió a la raíz; la fuente única es frontend/public/manifest.json"
    )


def test_public_manifest_exists_and_is_valid():
    datos = json.loads(_leer("frontend", "public", "manifest.json"))
    assert datos["name"]
    assert datos["start_url"]
    assert datos["icons"]


def test_manifest_theme_matches_index_html():
    """Fue justo theme_color lo primero que divergió entre las dos copias."""
    manifest = json.loads(_leer("frontend", "public", "manifest.json"))
    html = _leer("frontend", "index.html")

    m = re.search(r'<meta name="theme-color" content="([^"]+)"', html)
    assert m, "index.html no declara theme-color"
    assert manifest["theme_color"].lower() == m.group(1).lower(), (
        f"manifest {manifest['theme_color']} != index.html {m.group(1)}"
    )


# ========================================
# T5 · Higiene del repositorio
# ========================================

def _git(*args):
    return subprocess.run(["git", *args], cwd=RAIZ, capture_output=True, text=True).stdout


def test_build_artifacts_are_not_tracked():
    """mobile/www/ es una copia de dist/ que sync-apk regenera en cada build."""
    seguidos = [f for f in _git("ls-files").splitlines() if f.startswith("mobile/www/")]
    assert seguidos == [], f"mobile/www/ sigue versionado: {len(seguidos)} ficheros"


def test_apk_is_still_tracked_on_purpose():
    """
    Decisión explícita: se quiere que un clon traiga la app lista para instalar.
    Este test existe para que nadie la ignore "por higiene" sin darse cuenta.
    """
    assert "releases/ytmusic.apk" in _git("ls-files").splitlines(), (
        "ytmusic.apk dejó de versionarse; era una decisión deliberada mantenerla"
    )


@pytest.mark.parametrize("patron", ["mobile/www/", "dist/", "node_modules/", ".venv/"])
def test_gitignore_covers_build_output(patron):
    assert patron in _leer(".gitignore"), f"falta {patron} en .gitignore"


def test_deploy_scripts_are_ignored():
    """Contienen la IP del VPS."""
    gitignore = _leer(".gitignore")
    assert "scripts/deploy.sh" in gitignore
    assert "scripts/deploy.bat" in gitignore


def test_database_directory_is_ignored():
    assert "data/" in _leer(".gitignore")


# ========================================
# T2 · Paridad entre los dos scripts de build
# ========================================

# ========================================
# Estructura del proyecto
# ========================================

# Lo único que puede vivir en la raíz: lo que las herramientas buscan ahí.
# El código va en backend/, frontend/, mobile/, scripts/ o test/.
RAIZ_PERMITIDA = {
    ".github", ".gitignore", "LICENSE", "README.md",
    "backend", "docs", "frontend", "mobile", "releases", "scripts", "test",
    "eslint.config.mjs", "package.json", "package-lock.json",
    "playwright.config.js", "pyproject.toml", "vite.config.js",
}


def test_root_only_holds_tooling_config():
    """La raíz llegó a tener el backend, la web y los scripts mezclados."""
    en_raiz = {f.split("/")[0] for f in _git("ls-files").splitlines()}
    sobran = sorted(en_raiz - RAIZ_PERMITIDA)
    assert sobran == [], f"ficheros sueltos en la raíz: {sobran}"


@pytest.mark.parametrize("fichero", ["server.py", "database.py", "requirements.txt"])
def test_backend_lives_in_backend(fichero):
    assert _existe("backend", fichero)


@pytest.mark.parametrize("fichero", ["index.html", "download.html", "public/manifest.json", "src/main.js"])
def test_frontend_lives_in_frontend(fichero):
    assert _existe("frontend", *fichero.split("/"))


def test_build_script_exists_for_both_platforms():
    assert _existe("scripts", "sync-apk.sh"), "falta el script de macOS/Linux"
    assert _existe("scripts", "sync-apk.bat"), "falta el script de Windows"


def test_build_script_is_executable():
    assert os.access(os.path.join(RAIZ, "scripts", "sync-apk.sh"), os.X_OK), (
        "sync-apk.sh sin permiso de ejecución"
    )


@pytest.mark.parametrize("paso", [
    "npm run build",          # 1. build de Vite
    "mobile/www",             # 2. copiar dist a www
    "cap sync android",       # 3. sincronizar Capacitor
    "gradlew",                # 4. compilar
    "releases",               # 5. copiar el resultado a releases/ytmusic.apk
])
def test_both_scripts_do_the_same_steps(paso):
    """Si uno cambia y el otro no, las dos plataformas dejan de producir lo mismo."""
    sh = _leer("scripts", "sync-apk.sh")
    bat = _leer("scripts", "sync-apk.bat")
    assert paso in sh, f"sync-apk.sh no hace '{paso}'"
    assert paso.replace("/", "\\") in bat or paso in bat, f"sync-apk.bat no hace '{paso}'"


def test_npm_exposes_both_build_scripts():
    scripts = json.loads(_leer("package.json"))["scripts"]
    assert scripts.get("sync:apk"), "falta npm run sync:apk"
    assert scripts.get("sync:apk:win"), "falta npm run sync:apk:win"


def test_npm_exposes_the_test_suite():
    assert json.loads(_leer("package.json"))["scripts"].get("test")


# ========================================
# T4 · Configuración de servicio
# ========================================

def test_dev_server_is_only_in_main_block(srv):
    """
    app.run() debe quedar bajo `if __name__ == '__main__'`: en producción manda
    gunicorn y ese bloque no se ejecuta.
    """
    fuente = _leer("backend", "server.py")
    pos_main = fuente.index("if __name__ == '__main__':")
    assert "app.run(" not in fuente[:pos_main], (
        "app.run() fuera del bloque __main__: se ejecutaría bajo gunicorn"
    )


def test_single_worker_requirement_is_documented():
    """
    --workers 1 no es preferencia: el estado vive en memoria del proceso.
    Con varios workers, una petición de progreso puede caer en uno que no
    conoce esa descarga. Que quede escrito, o alguien lo "optimiza".
    """
    fuente = _leer("backend", "server.py")
    assert "--workers 1" in fuente, "el requisito de un solo worker no está documentado"


def test_bootstrap_runs_at_import_time(srv):
    """Bajo gunicorn el bloque __main__ no corre: bootstrap debe ser de módulo."""
    fuente = _leer("backend", "server.py")
    pos_main = fuente.index("if __name__ == '__main__':")
    assert re.search(r"^bootstrap\(\)", fuente[:pos_main], re.M), (
        "bootstrap() no se invoca a nivel de módulo"
    )


# ========================================
# Documentación
# ========================================

def test_mobile_readme_does_not_claim_remote_ui():
    """
    El README decía que la APK cargaba la interfaz del servidor y que no hacía
    falta recompilar. Es falso: capacitor.config.ts no define server.url.
    """
    readme = _leer("mobile", "README.md")
    assert "NO necesitas generar una nueva APK" not in readme
    assert "offline-first" in readme.lower()


def test_capacitor_config_has_no_server_url():
    """
    Un server.url olvidado tras una sesión de recarga en vivo deja la APK
    apuntando al portátil de quien la compiló.
    """
    config = _leer("mobile", "capacitor.config.ts")
    sin_comentarios = re.sub(r"//.*", "", config)
    assert not re.search(r"^\s*url\s*:", sin_comentarios, re.M), (
        "capacitor.config.ts define server.url: la APK no sería offline-first"
    )


@pytest.mark.parametrize("variable", ["JWT_SECRET", "YTDL_DATA_DIR"])
def test_env_vars_are_documented(variable):
    assert variable in _leer("README.md"), f"{variable} sin documentar en el README"


# ========================================
# Versión de Python
# ========================================

def test_python_requirement_is_documented():
    """
    gunicorn 25.x no publica ruedas para Python 3.9, así que
    `pip install -r requirements.txt` falla ahí. Producción corre 3.12: el
    requisito tiene que estar escrito o el fallo parece un misterio.
    """
    assert "3.10" in _leer("backend", "requirements.txt"), "requirements.txt no indica el Python mínimo"
    assert "Python 3.10" in _leer("README.md"), "el README no indica el Python mínimo"


def test_test_requirements_are_separate():
    """
    Los tests deben poder correr sin gunicorn, para no exigir Python 3.10+
    solo para ejecutar la suite.
    """
    deps_test = _leer("test", "requirements-test.txt").lower()
    assert "gunicorn" not in deps_test
    assert "pytest" in deps_test


def test_app_version_endpoint(client):
    """La APK pregunta aquí si hay una versión más nueva que la instalada."""
    respuesta = client.get("/api/app/version")
    assert respuesta.status_code == 200
    datos = respuesta.get_json()
    assert isinstance(datos["versionCode"], int)
    assert datos["versionName"]
    assert datos["novedades"]["es"]
    assert "max-age" in respuesta.headers.get("Cache-Control", "")


# ========================================
# Plan 10 · Icono temático y arranque de la APK
# ========================================

RES = ("mobile", "android", "app", "src", "main", "res")


@pytest.mark.parametrize("icono", ["ic_launcher.xml", "ic_launcher_round.xml"])
def test_adaptive_icon_has_monochrome_layer(icono):
    """Sin la capa monocroma, con los iconos temáticos de Android 13+ el nuestro era el único a color."""
    xml = _leer(*RES, "mipmap-anydpi-v26", icono)
    assert '<monochrome android:drawable="@drawable/ic_launcher_monochrome"' in xml


def test_monochrome_icon_is_a_single_colour_vector():
    xml = _leer(*RES, "drawable", "ic_launcher_monochrome.xml")
    assert xml.count("<path") >= 3
    colores = set(re.findall(r'android:fillColor="([^"]+)"', xml))
    assert colores == {"#FFFFFFFF"}, f"un icono temático es de un solo color: {colores}"


@pytest.mark.parametrize("elemento", [
    "windowSplashScreenBackground",
    "windowSplashScreenAnimatedIcon",
    "postSplashScreenTheme",
])
def test_launch_theme_uses_android_12_splash(elemento):
    """El arranque genérico pintaba un icono sobre blanco y saltaba a la WebView en negro."""
    estilos = _leer(*RES, "values", "styles.xml")
    bloque = estilos[estilos.index('name="AppTheme.NoActionBarLaunch"'):]
    bloque = bloque[:bloque.index("</style>")]
    assert f'name="{elemento}"' in bloque


def test_splash_hides_itself_even_if_javascript_fails():
    """Nunca una app atascada en su arranque: el tope es nativo, no depende de la web."""
    config = _leer("mobile", "capacitor.config.ts")
    bloque = config[config.index("SplashScreen: {"):]
    bloque = bloque[:bloque.index("}")]
    assert "launchAutoHide: true" in bloque
    assert re.search(r"launchShowDuration: \d{4}", bloque)
    assert "@capacitor/splash-screen" in _leer("mobile", "package.json")
