package com.assistencia.sistemaos;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.pdf.PdfDocument;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.util.regex.Pattern;

/** Rasteriza em bitmap antes de gravar: WebView.draw no canvas de PDF pode sair preto. */
final class PdfCompartilhavel {
    interface Resultado {
        void pronto(File arquivo);
        void falhou(String mensagem);
    }

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Resultado resultado;
    private final File arquivo;
    private final PdfDocument documento = new PdfDocument();
    private final int largura;
    private final int altura;
    private final int larguraPontos;
    private final int alturaPontos;
    private WebView webView;
    private Dialog dialog;
    private boolean terminou;
    private boolean carregou;
    private boolean temConteudo;
    private int paginas;
    private final Runnable timeout = () -> falhar("O documento demorou para carregar. Tente novamente.");

    PdfCompartilhavel(Activity activity, String html, File arquivo, Resultado resultado) {
        this.activity = activity;
        this.arquivo = arquivo;
        this.resultado = resultado;
        boolean paisagem = Pattern.compile("@page\\s*\\{[^}]*size\\s*:[^;}]*landscape", Pattern.CASE_INSENSITIVE)
            .matcher(html).find();
        largura = paisagem ? 1123 : 794; // A4 em pixels CSS (96 dpi).
        altura = paisagem ? 794 : 1123;
        larguraPontos = paisagem ? 842 : 595;
        alturaPontos = paisagem ? 595 : 842;
    }

    void gerar(String html) {
        try {
            webView = new WebView(activity);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setSupportZoom(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
            else if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
            if (Build.VERSION.SDK_INT >= 29) webView.setForceDarkAllowed(false);
            webView.setInitialScale(100);
            webView.setBackgroundColor(Color.WHITE);
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);

            // Uma WebView desconectada da janela não tem garantia de produzir um frame.
            FrameLayout superficie = new FrameLayout(activity);
            superficie.addView(webView, new FrameLayout.LayoutParams(largura, altura));
            TextView progresso = new TextView(activity);
            progresso.setText("Preparando documento…");
            progresso.setTextColor(Color.BLACK);
            progresso.setTextSize(18);
            progresso.setGravity(Gravity.CENTER);
            progresso.setBackgroundColor(Color.WHITE);
            superficie.addView(progresso, new FrameLayout.LayoutParams(-1, -1));
            dialog = new Dialog(activity);
            dialog.setContentView(superficie);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setOnCancelListener(ignorado -> falhar("Compartilhamento cancelado."));
            dialog.show();
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            handler.postDelayed(timeout, 45000);
            webView.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    if (terminou || carregou) return;
                    carregou = true;
                    AssinaturasPdf.preparar(view, () -> ajustarTermos(() -> aguardarFrame(() -> {
                        int alturaConteudo = Math.max(altura, Math.round(view.getContentHeight() * view.getScale()));
                        // Uma diferença de arredondamento de 1px não cria uma página vazia.
                        paginas = Math.max(1, (int) Math.ceil((alturaConteudo - 1) / (double) altura));
                        if (paginas > 40) { falhar("O documento excede o limite de 40 páginas."); return; }
                        view.setLayoutParams(new FrameLayout.LayoutParams(largura, paginas * altura));
                        view.measure(View.MeasureSpec.makeMeasureSpec(largura, View.MeasureSpec.EXACTLY),
                            View.MeasureSpec.makeMeasureSpec(paginas * altura, View.MeasureSpec.EXACTLY));
                        view.layout(0, 0, largura, paginas * altura);
                        aguardarFrame(() -> desenharPagina(0, 0));
                    })));
                }
            });
            String regras = "<meta name=\"viewport\" content=\"width=" + largura + ",initial-scale=1\">" +
                "<meta name=\"color-scheme\" content=\"light only\">" +
                "<style>html,body{background:#fff!important;color-scheme:light only!important;" +
                "-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}" +
                "html{margin:0!important;padding:0!important}.folha{box-shadow:none!important}</style>";
            String preparado = html.replaceAll("(?is)<meta\\b[^>]*name\\s*=\\s*['\"]viewport['\"][^>]*>", "");
            int fimHead = preparado.toLowerCase(java.util.Locale.ROOT).indexOf("</head>");
            preparado = fimHead >= 0 ? preparado.substring(0, fimHead) + regras + preparado.substring(fimHead) : regras + preparado;
            webView.loadDataWithBaseURL("https://sistemaos.local/", preparado, "text/html", "UTF-8", null);
        } catch (Exception erro) {
            falhar("Não foi possível preparar o documento.");
        }
    }

    private void ajustarTermos(Runnable pronto) {
        // Scripts vindos do HTML permanecem desativados durante o carregamento.
        // Executa apenas este ajuste fixo de layout, sem ponte Capacitor nem acesso a arquivos.
        webView.getSettings().setJavaScriptEnabled(true);
        webView.evaluateJavascript("(function(){var cabe=true;document.querySelectorAll('.termos-texto').forEach(function(el){" +
            "var px=parseFloat(getComputedStyle(el).fontSize)||10.4;var n=0;" +
            "while(el.scrollHeight>el.clientHeight+1&&px>7.34&&n++<100){px=Math.max(7.34,px-.25);" +
            "el.style.fontSize=px+'px';el.style.lineHeight='1.35';}" +
            "if(el.scrollHeight>el.clientHeight+1)cabe=false;});return cabe;})()", valor -> {
                if (terminou) return;
                webView.getSettings().setJavaScriptEnabled(false);
                if (!"true".equals(valor)) {
                    falhar("Os termos excedem o espaço do documento. Revise o texto antes de compartilhar.");
                    return;
                }
                pronto.run();
            });
    }

    private void aguardarFrame(Runnable acao) {
        if (terminou) return;
        webView.invalidate();
        webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                if (!terminou) handler.post(() -> { if (!terminou) acao.run(); });
            }
        });
    }

    // 0: vazio; 1: conteúdo em papel; 2: frame preto inválido.
    static int classificarPagina(Bitmap bitmap) {
        int claros = 0, escuros = 0, total = 0;
        for (int y = 0; y < bitmap.getHeight(); y += 5) {
            for (int x = 0; x < bitmap.getWidth(); x += 5) {
                int pixel = bitmap.getPixel(x, y);
                int luz = (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3;
                if (luz > 220) claros++;
                if (luz < 180) escuros++;
                total++;
            }
        }
        if (claros < total * 0.02) return 2;
        return escuros < 5 ? 0 : 1;
    }

    private void desenharPagina(int indice, int tentativa) {
        if (terminou) return;
        Bitmap bitmap = null;
        try {
            bitmap = Bitmap.createBitmap(largura * 2, altura * 2, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            Canvas raster = new Canvas(bitmap);
            raster.scale(2, 2);
            raster.translate(0, -indice * altura);
            webView.draw(raster);
            int classificacao = classificarPagina(bitmap);
            if (classificacao == 2 || (indice == 0 && classificacao == 0)) {
                bitmap.recycle();
                if (tentativa < 3) {
                    handler.postDelayed(() -> aguardarFrame(() -> desenharPagina(indice, tentativa + 1)), 250);
                } else {
                    falhar("O PDF ficou sem conteúdo visível. Nenhum arquivo foi enviado. Tente gerar novamente.");
                }
                return;
            }
            temConteudo |= classificacao == 1;
            // Descarta somente uma página final realmente vazia.
            if (classificacao != 0 || indice < paginas - 1) {
                PdfDocument.Page pagina = documento.startPage(new PdfDocument.PageInfo.Builder(larguraPontos, alturaPontos, indice + 1).create());
                pagina.getCanvas().drawColor(Color.WHITE);
                pagina.getCanvas().drawBitmap(bitmap, null, new Rect(0, 0, larguraPontos, alturaPontos), null);
                documento.finishPage(pagina);
            }
            bitmap.recycle();
            if (indice + 1 < paginas) {
                handler.post(() -> desenharPagina(indice + 1, 0));
            } else {
                if (!temConteudo) { falhar("O documento está vazio. Nenhum arquivo foi enviado."); return; }
                try (FileOutputStream saida = new FileOutputStream(arquivo)) { documento.writeTo(saida); }
                terminou = true;
                limpar();
                resultado.pronto(arquivo);
            }
        } catch (Exception | OutOfMemoryError erro) {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            falhar("Não foi possível gerar o PDF. Feche outros aplicativos e tente novamente.");
        }
    }

    private void falhar(String mensagem) {
        if (terminou) return;
        terminou = true;
        limpar();
        if (arquivo.exists()) arquivo.delete();
        resultado.falhou(mensagem);
    }

    private void limpar() {
        handler.removeCallbacks(timeout);
        documento.close();
        if (webView != null) {
            webView.stopLoading();
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
        }
        if (dialog != null) dialog.dismiss();
    }
}
