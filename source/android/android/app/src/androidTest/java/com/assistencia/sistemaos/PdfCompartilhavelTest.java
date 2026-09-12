package com.assistencia.sistemaos;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PdfCompartilhavelTest {
    @Test public void recusaFramePretoOuVazio() {
        Bitmap b = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888);
        b.eraseColor(Color.BLACK);
        assertEquals(2, PdfCompartilhavel.classificarPagina(b));
        b.eraseColor(Color.WHITE);
        assertEquals(0, PdfCompartilhavel.classificarPagina(b));
        b.recycle();
    }

    @Test public void documentosReaisSaoLegiveisEInteiros() throws Exception {
        try (ActivityScenario<PdfQaActivity> scenario = ActivityScenario.launch(PdfQaActivity.class)) {
            for (String nome : new String[]{"os", "entrega", "garantia", "desbloqueio", "compra", "venda", "multipagina"}) {
                String html;
                try (InputStream entrada = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("pdf-qa/" + nome + ".html")) {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int lidos;
                    while ((lidos = entrada.read(buffer)) != -1) bytes.write(buffer, 0, lidos);
                    html = bytes.toString("UTF-8");
                }
                CountDownLatch fim = new CountDownLatch(1);
                AtomicReference<String> erro = new AtomicReference<>();
                AtomicReference<File> pdf = new AtomicReference<>();
                scenario.onActivity(activity -> {
                    File destino = new File(activity.getExternalFilesDir(null), "qa-" + nome + ".pdf");
                    new PdfCompartilhavel(activity, html, destino, new PdfCompartilhavel.Resultado() {
                        @Override public void pronto(File arquivo) { pdf.set(arquivo); fim.countDown(); }
                        @Override public void falhou(String mensagem) { erro.set(mensagem); fim.countDown(); }
                    }).gerar(html);
                });
                assertTrue(nome + ": timeout", fim.await(55, TimeUnit.SECONDS));
                assertNull(nome + ": " + erro.get(), erro.get());
                assertNotNull(nome, pdf.get());
                try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(pdf.get(), ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer renderer = new PdfRenderer(fd)) {
                    if (nome.equals("multipagina")) assertEquals(2, renderer.getPageCount());
                    if (nome.equals("os")) assertEquals(1, renderer.getPageCount());
                    for (int i = 0; i < renderer.getPageCount(); i++) {
                        try (PdfRenderer.Page pagina = renderer.openPage(i)) {
                            assertEquals(nome.equals("os") || nome.equals("compra") || nome.equals("venda"), pagina.getWidth() > pagina.getHeight());
                            Bitmap b = Bitmap.createBitmap(pagina.getWidth(), pagina.getHeight(), Bitmap.Config.ARGB_8888);
                            b.eraseColor(Color.WHITE);
                            pagina.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                            assertEquals(nome + " página " + (i + 1) + " sem conteúdo", 1, PdfCompartilhavel.classificarPagina(b));
                            if (nome.equals("multipagina")) {
                                int cor = b.getPixel(80, 190);
                                if (i == 0) assertTrue("Bloco vermelho da primeira página", Color.red(cor) > Color.green(cor) * 2);
                                else assertTrue("Bloco verde da segunda página", Color.green(cor) > Color.red(cor) * 2);
                            }
                            b.recycle();
                        }
                    }
                }
            }
        }
    }
}
