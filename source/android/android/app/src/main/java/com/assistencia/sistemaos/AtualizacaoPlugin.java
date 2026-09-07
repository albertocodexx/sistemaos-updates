package com.assistencia.sistemaos;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.URLUtil;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.CancellationException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Atualizacao")
public class AtualizacaoPlugin extends Plugin {
    private static final long TAMANHO_MAXIMO_APK = 250L * 1024L * 1024L;
    private final Object travaDownload = new Object();
    private volatile Thread tarefaDownload;
    private volatile boolean cancelarDownload;
    private volatile boolean aplicativoVisivel;
    private String nomeDownloadAtivo;
    private String hashDownloadAtivo;
    private String urlPendente;
    private String nomePendente;
    private String hashPendente;
    private boolean aguardandoPermissao;

    private static boolean urlOficial(String endereco) {
        try {
            URL url = new URL(endereco);
            String host = url.getHost().toLowerCase(Locale.US);
            return "https".equalsIgnoreCase(url.getProtocol())
                && ("github.com".equals(host)
                    || "api.github.com".equals(host)
                    || host.endsWith(".githubusercontent.com"));
        } catch (Exception ignorado) {
            return false;
        }
    }

    @PluginMethod
    public void obterVersaoInstalada(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(
                getContext().getPackageName(),
                0
            );
            long codigo = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            call.resolve(new JSObject()
                .put("versao", info.versionName == null ? "" : info.versionName)
                .put("codigo", codigo));
        } catch (Exception erro) {
            call.reject("Nao foi possivel identificar a versao instalada.", erro);
        }
    }

    @PluginMethod
    public void abrirNoNavegador(PluginCall call) {
        String url = call.getString("url", "").trim();
        if (url.isEmpty() || !URLUtil.isHttpsUrl(url) || !urlOficial(url)) {
            call.reject("A página da atualização precisa pertencer ao GitHub oficial do Sistema OS.");
            return;
        }
        try {
            Intent navegador = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(navegador);
            call.resolve();
        } catch (Exception erro) {
            call.reject("Não foi possível abrir a página oficial do download.", erro);
        }
    }

    private static String calcularSha256(File arquivo) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream entrada = new FileInputStream(arquivo)) {
            byte[] buffer = new byte[64 * 1024];
            int lidos;
            while ((lidos = entrada.read(buffer)) != -1) digest.update(buffer, 0, lidos);
        }
        StringBuilder resultado = new StringBuilder(64);
        for (byte valor : digest.digest()) resultado.append(String.format(Locale.US, "%02x", valor));
        return resultado.toString();
    }

    @PluginMethod
    public void baixarEInstalar(PluginCall call) {
        String url = call.getString("url", "").trim();
        String nome = call.getString("nome", "SistemaOS-atualizacao.apk").trim();
        String sha256Esperado = call.getString("sha256", "").trim().toLowerCase(Locale.US);
        if (url.isEmpty() || !URLUtil.isHttpsUrl(url) || !urlOficial(url)) {
            call.reject("A atualização precisa vir do GitHub oficial do Sistema OS.");
            return;
        }
        if (!nome.matches("[A-Za-z0-9._-]+\\.apk")) nome = "SistemaOS-atualizacao.apk";
        if (!sha256Esperado.matches("[a-f0-9]{64}")) {
            call.reject("A atualização não possui uma verificação SHA-256 válida.");
            return;
        }
        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Abra o aplicativo para baixar a atualização.");
            return;
        }
        aplicativoVisivel = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            urlPendente = url;
            nomePendente = nome;
            hashPendente = sha256Esperado;
            aguardandoPermissao = true;
            try {
                Intent permissao = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(permissao);
                call.resolve(new JSObject()
                    .put("aguardandoPermissao", true)
                    .put("mensagem", "Autorize esta fonte. Ao voltar, o download iniciará uma única vez."));
            } catch (Exception erro) {
                aguardandoPermissao = false;
                call.reject("Não foi possível abrir a autorização de instalação.", erro);
            }
            return;
        }
        iniciarDownload(url, nome, sha256Esperado, call);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        aplicativoVisivel = true;
        if (!aguardandoPermissao || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (!getContext().getPackageManager().canRequestPackageInstalls()) return;
        aguardandoPermissao = false;
        String url = urlPendente;
        String nome = nomePendente;
        String hash = hashPendente;
        urlPendente = null;
        nomePendente = null;
        hashPendente = null;
        iniciarDownload(url, nome, hash, null);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        aplicativoVisivel = false;
        // O download pertence à tela aberta do Sistema OS. Ao sair, bloquear
        // ou fechar o aplicativo, a transferência é interrompida e nunca fica
        // se repetindo silenciosamente pelo Android.
        if (!aguardandoPermissao) cancelarDownloadAtivo();
    }

    @Override
    protected void handleOnDestroy() {
        cancelarDownloadAtivo();
        super.handleOnDestroy();
    }

    private void iniciarDownload(String url, String nome, String sha256Esperado, PluginCall call) {
        if (url == null || nome == null || sha256Esperado == null) {
            rejeitarOuAvisar(call, "Os dados da atualização não estão mais disponíveis.");
            return;
        }
        File pastaDownloads = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (pastaDownloads == null) {
            rejeitarOuAvisar(call, "O Android não liberou a pasta segura para a atualização.");
            return;
        }
        File arquivoApk = new File(pastaDownloads, nome);
        File arquivoParcial = new File(pastaDownloads, nome + ".part");

        synchronized (travaDownload) {
            if (tarefaDownload != null && tarefaDownload.isAlive()) {
                boolean mesmoArquivo = nome.equals(nomeDownloadAtivo)
                    && sha256Esperado.equalsIgnoreCase(hashDownloadAtivo);
                if (call != null) {
                    if (mesmoArquivo) {
                        call.resolve(new JSObject().put("reutilizado", true));
                    } else {
                        call.reject("Outra atualização já está sendo baixada.");
                    }
                }
                return;
            }
            cancelarDownload = false;
            nomeDownloadAtivo = nome;
            hashDownloadAtivo = sha256Esperado;
            tarefaDownload = new Thread(() -> {
                try {
                    if (arquivoApk.isFile()
                        && sha256Esperado.equalsIgnoreCase(calcularSha256(arquivoApk))) {
                        avisarStatus("instalando", "APK já baixado e validado. Abrindo a confirmação...", 100);
                        abrirInstalador(arquivoApk);
                        return;
                    }
                    if (arquivoApk.exists()) arquivoApk.delete();
                    if (arquivoParcial.exists()) arquivoParcial.delete();
                    baixarArquivo(url, arquivoParcial);
                    garantirAtivo();
                    String hashRecebido = calcularSha256(arquivoParcial);
                    if (!sha256Esperado.equalsIgnoreCase(hashRecebido)) {
                        arquivoParcial.delete();
                        throw new IllegalStateException("A verificação de segurança do APK falhou.");
                    }
                    if (!arquivoParcial.renameTo(arquivoApk)) {
                        copiarArquivo(arquivoParcial, arquivoApk);
                        arquivoParcial.delete();
                    }
                    garantirAtivo();
                    avisarStatus("instalando", "Download concluído. Abrindo a confirmação do Android...", 100);
                    abrirInstalador(arquivoApk);
                } catch (CancellationException ignorado) {
                    arquivoParcial.delete();
                    avisarStatus(
                        "disponivel",
                        "Download pausado ao sair do aplicativo. Toque em atualizar para tentar novamente.",
                        0
                    );
                } catch (Exception erro) {
                    arquivoParcial.delete();
                    avisarErro("Não foi possível instalar a atualização: " + erro.getMessage());
                } finally {
                    synchronized (travaDownload) {
                        tarefaDownload = null;
                        nomeDownloadAtivo = null;
                        hashDownloadAtivo = null;
                        cancelarDownload = false;
                    }
                }
            }, "SistemaOS-Atualizacao-Unica");
            tarefaDownload.start();
        }

        avisarStatus("baixando", "Baixando a atualização somente com o aplicativo aberto.", 0);
        if (call != null) call.resolve(new JSObject().put("downloadUnico", true));
    }

    private void baixarArquivo(String endereco, File destino) throws Exception {
        HttpURLConnection conexao = abrirConexao(endereco);
        try {
            long total = conexao.getContentLengthLong();
            if (total > TAMANHO_MAXIMO_APK) {
                throw new IllegalStateException("O arquivo informado excede o limite seguro do aplicativo.");
            }
            long recebidos = 0L;
            int ultimoProgresso = -1;
            try (
                InputStream entrada = conexao.getInputStream();
                FileOutputStream saida = new FileOutputStream(destino, false)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int lidos;
                while ((lidos = entrada.read(buffer)) != -1) {
                    garantirAtivo();
                    saida.write(buffer, 0, lidos);
                    recebidos += lidos;
                    if (recebidos > TAMANHO_MAXIMO_APK) {
                        throw new IllegalStateException("O download excedeu o limite seguro do aplicativo.");
                    }
                    int progresso = total > 0L
                        ? (int) Math.min(100L, Math.round(recebidos * 100.0 / total))
                        : 0;
                    if (progresso != ultimoProgresso) {
                        ultimoProgresso = progresso;
                        avisarStatus("baixando", "Baixando atualização: " + progresso + "%", progresso);
                    }
                }
                saida.flush();
            }
        } finally {
            conexao.disconnect();
        }
    }

    private HttpURLConnection abrirConexao(String endereco) throws Exception {
        String atual = endereco;
        for (int tentativa = 0; tentativa < 6; tentativa++) {
            if (!urlOficial(atual)) {
                throw new IllegalStateException("O servidor redirecionou para um endereço não autorizado.");
            }
            HttpURLConnection conexao = (HttpURLConnection) new URL(atual).openConnection();
            conexao.setInstanceFollowRedirects(false);
            conexao.setConnectTimeout(15000);
            conexao.setReadTimeout(30000);
            conexao.setRequestProperty("Accept", "application/vnd.android.package-archive");
            conexao.setRequestProperty("User-Agent", "SistemaOS-Android");
            int codigo = conexao.getResponseCode();
            if (codigo >= 300 && codigo < 400) {
                String local = conexao.getHeaderField("Location");
                conexao.disconnect();
                if (local == null || local.trim().isEmpty()) {
                    throw new IllegalStateException("O servidor não informou o destino do APK.");
                }
                atual = new URL(new URL(atual), local).toString();
                continue;
            }
            if (codigo < 200 || codigo >= 300) {
                conexao.disconnect();
                throw new IllegalStateException("O servidor retornou o código " + codigo + ".");
            }
            return conexao;
        }
        throw new IllegalStateException("O download foi redirecionado muitas vezes.");
    }

    private static void copiarArquivo(File origem, File destino) throws Exception {
        try (
            InputStream entrada = new FileInputStream(origem);
            FileOutputStream saida = new FileOutputStream(destino, false)
        ) {
            byte[] buffer = new byte[64 * 1024];
            int lidos;
            while ((lidos = entrada.read(buffer)) != -1) saida.write(buffer, 0, lidos);
            saida.flush();
        }
    }

    private void garantirAtivo() {
        if (cancelarDownload || !aplicativoVisivel || Thread.currentThread().isInterrupted()) {
            throw new CancellationException("Download interrompido.");
        }
    }

    private void cancelarDownloadAtivo() {
        synchronized (travaDownload) {
            cancelarDownload = true;
            if (tarefaDownload != null) tarefaDownload.interrupt();
        }
    }

    private void abrirInstalador(File arquivoApk) {
        if (!arquivoApk.isFile()) {
            avisarErro("O APK baixado não foi encontrado.");
            return;
        }
        if (!aplicativoVisivel || getActivity() == null || getActivity().isFinishing()) {
            avisarStatus("disponivel", "APK pronto. Abra o aplicativo e toque em atualizar para instalar.", 100);
            return;
        }
        try {
            validarPacoteAntesDeInstalar(arquivoApk);
            Uri apk = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                arquivoApk
            );
            Intent instalar = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apk, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            instalar.setClipData(ClipData.newRawUri("Atualização do Sistema OS", apk));
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(instalar);
                    avisarStatus("confirmacao", "Confirme a atualização na tela do Android.", 100);
                } catch (Exception erro) {
                    avisarErro("Não foi possível abrir o instalador: " + erro.getMessage());
                }
            });
        } catch (Exception erro) {
            avisarErro("Não foi possível preparar o instalador: " + erro.getMessage());
        }
    }

    private void validarPacoteAntesDeInstalar(File arquivoApk) throws Exception {
        PackageManager gerenciador = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo instalada = gerenciador.getPackageInfo(getContext().getPackageName(), flags);
        PackageInfo nova = gerenciador.getPackageArchiveInfo(arquivoApk.getAbsolutePath(), flags);
        if (nova == null || nova.packageName == null) {
            throw new SecurityException("O arquivo baixado nao e um APK valido.");
        }
        if (!getContext().getPackageName().equals(nova.packageName)) {
            throw new SecurityException("O APK pertence a outro aplicativo.");
        }
        if (!assinaturasCompativeis(instalada, nova)) {
            throw new SecurityException(
                "A versao instalada usa uma assinatura antiga. Faca o backup em Configuracoes, " +
                "desinstale o Sistema OS antigo e instale o APK novo uma unica vez."
            );
        }
    }

    private static Signature[] obterAssinaturas(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo == null) return new Signature[0];
            return info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        }
        return info.signatures == null ? new Signature[0] : info.signatures;
    }

    private static boolean assinaturasCompativeis(PackageInfo instalada, PackageInfo nova) {
        Signature[] atuais = obterAssinaturas(instalada);
        Signature[] recebidas = obterAssinaturas(nova);
        for (Signature atual : atuais) {
            for (Signature recebida : recebidas) {
                if (MessageDigest.isEqual(atual.toByteArray(), recebida.toByteArray())) return true;
            }
        }
        return false;
    }

    private void rejeitarOuAvisar(PluginCall call, String mensagem) {
        if (call != null) call.reject(mensagem);
        else avisarErro(mensagem);
    }

    private void avisarStatus(String fase, String mensagem, int progresso) {
        notifyListeners("atualizacaoStatus", new JSObject()
            .put("fase", fase)
            .put("mensagem", mensagem)
            .put("progresso", progresso));
    }

    private void avisarErro(String mensagem) {
        notifyListeners("atualizacaoErro", new JSObject().put("erro", mensagem));
    }
}
