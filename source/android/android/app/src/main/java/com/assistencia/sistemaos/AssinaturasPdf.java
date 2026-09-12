package com.assistencia.sistemaos;

import android.webkit.WebView;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Executa somente o código embarcado, com o HTML já carregado sem scripts. */
final class AssinaturasPdf {
    static void preparar(WebView view, Runnable pronto) {
        try (InputStream arquivo = view.getContext().getAssets().open("public/js/pdf-assinaturas.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int lidos;
            while ((lidos = arquivo.read(buffer)) != -1) bytes.write(buffer, 0, lidos);
            String script = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            view.getSettings().setJavaScriptEnabled(true);
            view.evaluateJavascript(script + "\nSistemaOSPdfAssinaturas.preparar(document);", valor -> {
                view.getSettings().setJavaScriptEnabled(false);
                view.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long id) { pronto.run(); }
                });
            });
        } catch (Exception erro) {
            view.getSettings().setJavaScriptEnabled(false);
            pronto.run(); // Sem perder um documento por falha no ajuste visual.
        }
    }
}
