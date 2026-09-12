package com.assistencia.sistemaos;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.pdf.PrintedPdfDocument;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "Impressao")
public class ImpressaoPlugin extends Plugin {
    private WebView webViewImpressao;

    private WebView prepararWebView(String html, WebViewClient cliente) {
        WebView webView = new WebView(getContext());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(cliente);
        webView.loadDataWithBaseURL(
            "https://sistemaos.local/",
            html,
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
        WebView view,
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
            Intent envio = new Intent(Intent.ACTION_SEND);
            envio.setType("application/pdf");
            envio.putExtra(Intent.EXTRA_STREAM, uri);
            if (!mensagem.trim().isEmpty()) envio.putExtra(Intent.EXTRA_TEXT, mensagem);
            envio.setClipData(ClipData.newRawUri("PDF Sistema OS", uri));
            envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(envio, titulo));
            JSObject resultado = new JSObject();
            resultado.put("sucesso", true);
            resultado.put("nomeArquivo", nomeArquivo);
            call.resolve(resultado);
        } catch (Exception erro) {
            call.reject("Não foi possível compartilhar o PDF: " + erro.getMessage(), erro);
        } finally {
            encerrarWebView(view);
        }
    }

    private void gerarECompartilharPdf(
        WebView view,
        File pdf,
        String nomeArquivo,
        String titulo,
        String mensagem,
        PluginCall call
    ) {
        PrintAttributes atributos = new PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            .setResolution(new PrintAttributes.Resolution("pdf", "PDF", 144, 144))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
            .build();
        PrintedPdfDocument documento = new PrintedPdfDocument(getContext(), atributos);
        try {
            Rect area = documento.getPageContentRect();
            int largura = Math.max(1, area.width());
            view.measure(
                android.view.View.MeasureSpec.makeMeasureSpec(largura, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(0, android.view.View.MeasureSpec.UNSPECIFIED)
            );
            int alturaConteudo = Math.max(
                view.getMeasuredHeight(),
                Math.round(view.getContentHeight() * view.getScale())
            );
            alturaConteudo = Math.max(1, alturaConteudo);
            view.layout(0, 0, largura, alturaConteudo);
            int alturaPagina = Math.max(1, area.height());
            int totalPaginas = Math.max(1, (int) Math.ceil(alturaConteudo / (double) alturaPagina));

            for (int indice = 0; indice < totalPaginas; indice++) {
                PdfDocument.Page pagina = documento.startPage(indice);
                Canvas canvas = pagina.getCanvas();
                canvas.save();
                canvas.clipRect(area);
                canvas.translate(area.left, area.top - (indice * alturaPagina));
                view.draw(canvas);
                canvas.restore();
                documento.finishPage(pagina);
            }

            if (pdf.exists() && !pdf.delete()) {
                throw new IllegalStateException("O arquivo temporário anterior está em uso.");
            }
            try (FileOutputStream saida = new FileOutputStream(pdf)) {
                documento.writeTo(saida);
                saida.flush();
            }
        } catch (Exception erro) {
            encerrarWebView(view);
            call.reject("Não foi possível gerar o PDF: " + erro.getMessage(), erro);
            return;
        } finally {
            documento.close();
        }
        compartilharArquivoPdf(view, pdf, nomeArquivo, titulo, mensagem, call);
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
            try {
                AtomicBoolean paginaCarregada = new AtomicBoolean(false);
                prepararWebView(html, new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (!paginaCarregada.compareAndSet(false, true)) return;
                        File pasta = new File(getContext().getCacheDir(), "documentos-compartilhados");
                        if (!pasta.exists() && !pasta.mkdirs()) {
                            encerrarWebView(view);
                            call.reject("Não foi possível preparar a pasta temporária do PDF.");
                            return;
                        }
                        File pdf = new File(pasta, nomeArquivo);
                        gerarECompartilharPdf(view, pdf, nomeArquivo, titulo, mensagem, call);
                    }
                });
            } catch (Exception erro) {
                call.reject("Não foi possível preparar o PDF: " + erro.getMessage(), erro);
            }
        });
    }
}
