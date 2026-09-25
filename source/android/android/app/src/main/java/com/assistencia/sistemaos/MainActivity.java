package com.assistencia.sistemaos;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtualizacaoPlugin.class);
        registerPlugin(ImpressaoPlugin.class);
        // Somente pastas privadas do app: não alterar a galeria/Downloads do usuário.
        // Preparar antes do WebView/plugins, para não haver janela sem o marcador.
        MidiaPrivada.proteger(getFilesDir());
        MidiaPrivada.proteger(getCacheDir());
        MidiaPrivada.proteger(getExternalFilesDir(null));
        MidiaPrivada.proteger(getExternalCacheDir());
        super.onCreate(savedInstanceState);
    }
}
