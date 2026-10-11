package es.dannarita.music;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Complementos propios: se registran antes de arrancar el puente
        registerPlugin(PermisoAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
