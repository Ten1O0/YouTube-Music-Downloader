package es.dannarita.music;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * El permiso para leer el audio de las carpetas públicas (Documentos/YTMusic,
 * Descargas y Música), para encontrar las canciones al escanearlas.
 *
 * El complemento Filesystem de Capacitor da su permiso por concedido desde
 * Android 11 sin pedir ninguno, y nadie pedía READ_MEDIA_AUDIO (Android 13+)
 * ni READ_EXTERNAL_STORAGE (11 y 12). Sin ellos, la app solo ve los ficheros
 * que creó ella misma en esta instalación: tras reinstalarla o borrar sus
 * datos, las canciones bajadas antes no aparecían al escanear (de unas 50, el
 * usuario recuperó unas 20).
 */
@CapacitorPlugin(
    name = "PermisoAudio",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "almacenamiento")
    }
)
public class PermisoAudioPlugin extends Plugin {

    /** El permiso que toca en esta versión de Android. */
    private String alias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "almacenamiento";
    }

    @PluginMethod
    public void estado(PluginCall call) {
        responder(call);
    }

    @PluginMethod
    public void pedir(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) {
            responder(call);
            return;
        }
        requestPermissionForAlias(alias(), call, "alResponder");
    }

    @PermissionCallback
    private void alResponder(PluginCall call) {
        responder(call);
    }

    private void responder(PluginCall call) {
        JSObject resultado = new JSObject();
        resultado.put("audio", getPermissionState(alias()) == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(resultado);
    }
}
