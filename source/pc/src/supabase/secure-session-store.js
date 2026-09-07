const fs = require('fs');
const path = require('path');

class SecureSessionStore {
  constructor({ rootDir, safeStorage }) {
    if (!rootDir) throw new Error('Diretório raiz obrigatório para a sessão Supabase.');
    this.safeStorage = safeStorage;
    this.filePath = path.join(rootDir, 'supabase-session.enc.json');
    this.memoria = {};
  }

  _podeCriptografar() {
    try { return !!this.safeStorage?.isEncryptionAvailable?.(); }
    catch (_) { return false; }
  }

  _lerDisco() {
    if (!this._podeCriptografar()) return {};
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const dados = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return dados && typeof dados === 'object' ? dados : {};
    } catch (erro) {
      console.error('[Supabase] Não foi possível ler a sessão criptografada:', erro.message);
      return {};
    }
  }

  _salvarDisco(dados) {
    if (!this._podeCriptografar()) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporario = this.filePath + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify(dados), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporario, this.filePath);
  }

  getItem(chave) {
    if (Object.prototype.hasOwnProperty.call(this.memoria, chave)) return this.memoria[chave];
    if (!this._podeCriptografar()) return null;
    const dados = this._lerDisco();
    if (!dados[chave]) return null;
    try {
      const valor = this.safeStorage.decryptString(Buffer.from(dados[chave], 'base64'));
      this.memoria[chave] = valor;
      return valor;
    } catch (erro) {
      console.error('[Supabase] Sessão criptografada inválida; o login será solicitado novamente.');
      // Outro perfil do Electron/Windows pode não ter a chave de leitura.
      // Preservar a entrada permite recuperá-la no perfil original.
      return null;
    }
  }

  setItem(chave, valor) {
    this.memoria[chave] = String(valor);
    if (!this._podeCriptografar()) return;
    const dados = this._lerDisco();
    dados[chave] = this.safeStorage.encryptString(String(valor)).toString('base64');
    this._salvarDisco(dados);
  }

  removeItem(chave) {
    delete this.memoria[chave];
    if (!this._podeCriptografar()) return;
    const dados = this._lerDisco();
    delete dados[chave];
    this._salvarDisco(dados);
  }

  limpar() {
    this.memoria = {};
    try { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); } catch (_) { /* best effort */ }
  }

  persistenciaCriptografadaDisponivel() {
    return this._podeCriptografar();
  }

  _lerContasRapidas() {
    try {
      const valor = this.getItem('__sistema_os_contas_rapidas_v1__');
      const contas = valor ? JSON.parse(valor) : [];
      return Array.isArray(contas) ? contas : [];
    } catch (_) {
      return [];
    }
  }

  listarContasRapidas() {
    return this._lerContasRapidas().map((conta) => ({ ...conta }));
  }

  salvarContaRapida(conta) {
    if (!this._podeCriptografar()) {
      throw new Error('O cofre seguro do Windows nao esta disponivel neste computador.');
    }
    const id = String(conta?.id || '').trim();
    if (!id || !conta?.refreshToken || !conta?.accessToken) {
      throw new Error('Sessao invalida para troca rapida.');
    }
    const contas = this._lerContasRapidas().filter((item) => item.id !== id);
    contas.unshift({ ...conta, id, atualizadoEm: new Date().toISOString() });
    this.setItem('__sistema_os_contas_rapidas_v1__', JSON.stringify(contas.slice(0, 12)));
    return id;
  }

  obterContaRapida(id) {
    return this._lerContasRapidas().find((conta) => conta.id === String(id || '')) || null;
  }

  removerContaRapida(id) {
    const contas = this._lerContasRapidas().filter((conta) => conta.id !== String(id || ''));
    this.setItem('__sistema_os_contas_rapidas_v1__', JSON.stringify(contas));
    return true;
  }

  removerContasRapidasDaEmpresa(empresaId) {
    const contas = this._lerContasRapidas().filter((conta) => conta.empresaId !== String(empresaId || ''));
    this.setItem('__sistema_os_contas_rapidas_v1__', JSON.stringify(contas));
  }
}

module.exports = { SecureSessionStore };
