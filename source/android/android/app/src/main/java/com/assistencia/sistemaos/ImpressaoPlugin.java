package com.assistencia.sistemaos;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.ShareCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "Impressao")
public class ImpressaoPlugin extends Plugin {
    private WebView webViewImpressao;
    private boolean gerandoPdf;

    private WebView prepararWebView(String html, WebViewClient cliente) {
        WebView webView = new WebView(getContext());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
            webView.setForceDarkAllowed(false);
        }
        webView.setBackgroundColor(Color.WHITE);
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        webView.setWebViewClient(cliente);
        String regrasDocumentoClaro =
            "<meta name=\"color-scheme\" content=\"light only\">" +
            "<style>html,body{background:#fff!important;color-scheme:light only!important;" +
            "-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style>";
        String htmlClaro = html.contains("</head>")
            ? html.replace("</head>", regrasDocumentoClaro + "</head>")
            : regrasDocumentoClaro + html;
        webView.loadDataWithBaseURL(
            "https://sistemaos.local/",
            htmlClaro,
            "text/html",
            "UTF-8",
            null
        );
        webViewImpressao = webView;
        return webView;
    }

    private String nomePdfSeguro(String nome) {
        String seguro = String.valueOf(nome == null ? "documento-sistema-os.pdf" : nome)
            .replaceAll("[^A-Za-z0-9._-]", "-")
            .replaceAll("-+", "-");
        if (seguro.isEmpty()) seguro = "documento-sistema-os.pdf";
        if (!seguro.toLowerCase().endsWith(".pdf")) seguro += ".pdf";
        return seguro;
    }

    private void encerrarWebView(WebView view) {
        try { view.destroy(); } catch (Exception ignorado) { }
        if (webViewImpressao == view) webViewImpressao = null;
    }

    private void compartilharArquivoPdf(
        File pdf,
        String nomeArquivo,
        String titulo,
        String mensagem,
        PluginCall call
    ) {
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                pdf
            );
            Intent envio = new ShareCompat.IntentBuilder(getActivity())
                .setType("application/pdf")
                .setStream(uri)
                .setSubject(titulo)
                .setText(mensagem)
                .getIntent();
            envio.putExtra(Intent.EXTRA_TEXT, mensagem);
            envio.putExtra(Intent.EXTRA_STREAM, uri);
            envio.putExtra(Intent.EXTRA_TITLE, titulo);
            ClipData.Item item = new ClipData.Item(mensagem, null, null, uri);
            envio.setClipData(new ClipData(
                new ClipDescription("PDF Sistema OS", new String[]{"application/pdf", "text/plain"}),
                item
            ));
            envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            boolean mensagemCopiada = false;
            try { if (!mensagem.trim().isEmpty()) {
                ClipboardManager clipboard = (ClipboardManager) getContext()
                    .getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("Mensagem do Sistema OS", mensagem));
                    mensagemCopiada = true;
                }
            } } catch (RuntimeException ignorado) { /* O PDF ainda pode ser compartilhado. */ }
            getActivity().startActivity(Intent.createChooser(envio, titulo));
            JSObject resultado = new JSObject();
            resultado.put("sucesso", true);
            resultado.put("nomeArquivo", nomeArquivo);
            resultado.put("mensagemCopiada", mensagemCopiada);
            call.resolve(resultado);
        } catch (Exception erro) {
            call.reject("Não foi possível compartilhar o PDF: " + erro.getMessage(), erro);
        }
    }

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
                prepararWebView(html, new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        AssinaturasPdf.preparar(view, () -> {
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
                        });
                    }
                });
            } catch (Exception erro) {
                call.reject("Não foi possível preparar o comprovante: " + erro.getMessage(), erro);
            }
        });
    }

    /**
     * Converte o HTML do documento em um PDF dentro do cache privado e abre
     * o compartilhamento do Android com o arquivo e a mensagem já preenchida.
     * O arquivo temporário não fica exposto no armazenamento público.
     */
    @PluginMethod
    public void compartilharPdf(PluginCall call) {
        final String html = call.getString("html", "");
        final String titulo = call.getString("titulo", "Documento Sistema OS");
        final String mensagem = call.getString("mensagem", "");
        final String nomeArquivo = nomePdfSeguro(call.getString("nomeArquivo", "documento-sistema-os.pdf"));
        if (html.trim().isEmpty()) {
            call.reject("O documento está vazio.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (gerandoPdf) { call.reject("Aguarde o documento atual terminar de ser gerado."); return; }
            gerandoPdf = true;
            try {
                File pasta = new File(getContext().getCacheDir(), "documentos-compartilhados");
                if (!pasta.exists() && !pasta.mkdirs()) throw new IllegalStateException("Pasta temporária indisponível.");
                // Cada envio conserva seu arquivo, mesmo se o mesmo documento for gerado novamente.
                File lote = new File(pasta, "envio-" + java.util.UUID.randomUUID());
                if (!lote.mkdir()) throw new IllegalStateException("Pasta de envio indisponível.");
                File pdf = new File(lote, nomeArquivo);
                new PdfCompartilhavel(getActivity(), html, pdf, new PdfCompartilhavel.Resultado() {
                    @Override public void pronto(File arquivo) {
                        gerandoPdf = false;
                        compartilharArquivoPdf(arquivo, nomeArquivo, titulo, mensagem, call);
                    }
                    @Override public void falhou(String mensagemErro) {
                        gerandoPdf = false;
                        call.reject(mensagemErro);
                    }
                }).gerar(html);
            } catch (Exception erro) {
                gerandoPdf = false;
                call.reject("Não foi possível preparar o PDF: " + erro.getMessage(), erro);
            }
        });
    }
}
