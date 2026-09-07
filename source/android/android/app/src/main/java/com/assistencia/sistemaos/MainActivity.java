package com.assistencia.sistemaos;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtualizacaoPlugin.class);
        registerPlugin(ImpressaoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
