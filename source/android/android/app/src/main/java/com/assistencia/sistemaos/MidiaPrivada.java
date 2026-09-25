package com.assistencia.sistemaos;

import java.io.File;
import java.io.IOException;

/** Impede a indexação de mídia técnica nas pastas exclusivas do aplicativo. */
final class MidiaPrivada {
    private MidiaPrivada() {}

    static boolean proteger(File pastaDoApp) {
        if (pastaDoApp == null) return false;
        try {
            if (!pastaDoApp.isDirectory() && !pastaDoApp.mkdirs()) return false;
            File marcador = new File(pastaDoApp, ".nomedia");
            return marcador.isFile() || marcador.createNewFile();
        } catch (IOException | SecurityException ignored) {
            // Cartão removido ou armazenamento indisponível não impede a abertura.
            return false;
        }
    }
}
