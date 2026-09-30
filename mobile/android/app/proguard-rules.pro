# Reglas de R8 para la compilación de release (plan 19, T14).
#
# Capacitor ya trae las suyas (consumerProguardFiles de capacitor-android):
# conserva cada clase que extiende com.getcapacitor.Plugin con sus métodos
# @PluginMethod, que el puente busca por nombre desde capacitor.plugins.json.
# Los métodos @JavascriptInterface y las anotaciones los conserva
# proguard-android-optimize.txt. Aquí va lo que falta para esta app.

# Los plugins se instancian por reflexión a partir de su nombre de clase, y
# sus anotaciones (@CapacitorPlugin, @Permission) se leen en tiempo de ejecución
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }

# Plugins de la app: los de @capacitor/* y la sesión multimedia
-keep class com.capacitorjs.plugins.** { *; }
-keep class io.github.jofr.capacitor.** { *; }

# La actividad principal y el paquete de la app
-keep class es.dannarita.music.** { *; }

# Trazas de errores legibles en los informes de fallo
-keepattributes SourceFile,LineNumberTable
