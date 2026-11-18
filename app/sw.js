// Service worker mínimo: é o que permite ao Android oferecer "Instalar aplicativo".
// Não guarda nada em cache (o app sempre busca a versão nova). Cuida das
// aberturas de página (sem internet, mostra um aviso em vez da tela de erro)
// e das notificações (App 2.0).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const SEM_INTERNET = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sem internet</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
background:#f6f6f9;color:#1b1b2b;text-align:center;padding:24px}h1{font-size:22px}p{font-size:17px;color:#555}
button{margin-top:16px;min-height:52px;padding:0 28px;border:0;border-radius:12px;background:#e8392f;color:#fff;
font-size:17px;font-weight:700}</style></head><body><div><h1>Sem conexão com a internet</h1>
<p>Confira o Wi-Fi ou os dados móveis do celular e tente de novo.</p>
<button onclick="location.reload()">Tentar de novo</button></div></body></html>`;

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // imagens, API etc. seguem direto
  e.respondWith(
    fetch(e.request).catch(
      () => new Response(SEM_INTERNET, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});

// Notificações (App 2.0): enviadas pelo painel (função "push" do Supabase).
// Toda mensagem PRECISA virar uma notificação visível (o iPhone corta os avisos de quem não mostra).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || 'Novidade para você', {
      body: d.texto || '',
      icon: d.icone,
      badge: d.icone,
      tag: d.envio || undefined,
      data: { link: d.link || '#/', envio: d.envio, aparelho: d.aparelho, toque: d.toque },
    }),
  );
});

// Tocou na notificação: abre o destino e conta o toque.
//  - tela do app ("#/..."): abre o app nela (ou traz o app aberto para frente);
//  - link de fora ("https://...", ex.: página de pagamento): abre o link direto.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const externo = /^https:\/\//.test(d.link || '');
  // ?origem=notificacao: o app conta esta abertura como vinda da notificação (e limpa o endereço)
  const url = externo ? d.link : new URL('/app/?origem=notificacao' + (d.link || '#/'), self.location.origin).href;
  e.waitUntil((async () => {
    if (d.toque && d.envio && d.aparelho) {
      fetch(d.toque, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envio: d.envio, aparelho: d.aparelho }) }).catch(() => {});
    }
    if (externo) return self.clients.openWindow(url);
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if (new URL(j.url).origin !== self.location.origin) continue;
      await j.focus();
      if ('navigate' in j) await j.navigate(url).catch(() => {});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
