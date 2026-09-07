/* Configuração pública distribuída com o APK.
 * A chave publishable identifica o projeto; RLS e login continuam
 * obrigatórios. Nunca inclua service_role, sb_secret_ ou chaves de IA aqui.
 */
(function (root) {
  root.SistemaOSPublicConfig = Object.freeze({
    supabaseObrigatorio: true,
    supabaseUrl: 'https://ovsutqbzxqmtfipkeumu.supabase.co',
    supabasePublishableKey: 'sb_publishable_9c0Kav5UXztK8tjSsFm1rA_mM2zv4y1',
    supabaseRedirectUrl: 'com.assistencia.sistemaos://auth/callback'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
