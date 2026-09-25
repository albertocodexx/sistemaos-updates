package com.assistencia.sistemaos;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class MidiaPrivadaTest {
    @Rule public TemporaryFolder temporarios = new TemporaryFolder();

    @Test public void protegePastaPrivadaSemAlterarFotosOuPastaPublica() throws Exception {
        File raiz = temporarios.newFolder("armazenamento");
        File fotos = new File(raiz, "Pictures");
        assertTrue(fotos.mkdir());
        File foto = new File(fotos, "foto-pessoal.jpg");
        byte[] original = new byte[] {1, 2, 3, 4};
        Files.write(foto.toPath(), original);
        File privada = new File(raiz, "Android/data/com.assistencia.sistemaos/files");
        assertTrue(MidiaPrivada.proteger(privada));
        assertTrue(MidiaPrivada.proteger(privada));
        assertTrue(new File(privada, ".nomedia").isFile());
        assertEquals(0, new File(privada, ".nomedia").length());
        assertFalse(new File(raiz, ".nomedia").exists());
        assertFalse(new File(fotos, ".nomedia").exists());
        assertArrayEquals(original, Files.readAllBytes(foto.toPath()));
    }

    @Test public void falhaDeArmazenamentoNaoApagaOuSobrescreveArquivo() throws Exception {
        assertFalse(MidiaPrivada.proteger(null));
        File arquivo = temporarios.newFile("nao-e-pasta");
        assertFalse(MidiaPrivada.proteger(arquivo));
        assertTrue(arquivo.isFile());
    }
}
