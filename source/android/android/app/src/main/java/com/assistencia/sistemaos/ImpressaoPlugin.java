package com.assistencia.sistemaos;

import android.content.Context;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Impressao")
public class ImpressaoPlugin extends Plugin {
    private WebView webViewImpressao;

    @PluginMethod
    public void imprimir(PluginCall call) {
        final String html = call.getString("html", "");
        final String titulo = call.getString("titulo", "Comprovante Sistema OS");
        if (html.trim().isEmpty()) {
            call.reject("O comprovante está vazio.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                webViewImpressao = new WebView(getContext());
                WebSettings settings = webViewImpressao.getSettings();
                settings.setJavaScriptEnabled(false);
                settings.setAllowFileAccess(false);
                settings.setAllowContentAccess(false);
                webViewImpressao.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager manager = (PrintManager) getContext()
                                .getSystemService(Context.PRINT_SERVICE);
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(titulo);
                            manager.print(titulo, adapter, null);
                            JSObject resultado = new JSObject();
                            resultado.put("sucesso", true);
                            call.resolve(resultado);
                        } catch (Exception erro) {
                            call.reject("Não foi possível abrir a impressão: " + erro.getMessage(), erro);
                        }
                    }
                });
                webViewImpressao.loadDataWithBaseURL(
                    "https://sistemaos.local/",
                    html,
                    "text/html",
                    "UTF-8",
                    null
                );
            } catch (Exception erro) {
                call.reject("Não foi possível preparar o comprovante: " + erro.getMessage(), erro);
            }
        });
    }
}
