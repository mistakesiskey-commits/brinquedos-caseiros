// Área de Membros — app do aluno (Preact + htm, sem etapa de build).
// Rotas por hash para funcionar em qualquer hospedagem estática:
//   #/                   início
//   #/produto/<id>       lista de aulas
//   #/aula/<id>          vídeo ou PDF
import { html, render, useState, useEffect, useMemo, useRef } from './vendor/preact-htm.js';
import { API_URL, MARCA_LOCAL, VAPID_PUBLICA } from './config.js';

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

const guardar = {
  ler(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; }
  },
  salvar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* navegador sem storage */ }
  },
  apagar(chave) {
    try { localStorage.removeItem(chave); } catch { /* idem */ }
  },
};

function marcaDaUrl() {
  const forcada = new URLSearchParams(location.search).get('marca');
  if (forcada) return forcada;
  return MARCA_LOCAL;
}

// Sem resposta no tempo limite, sem conexão ou servidor com erro (5xx) → codigo 'instabilidade' (status 0 se não respondeu).
// Foi o que deixou o app em branco na queda do Supabase de 24/10/2026: a espera era sem limite.
async function api(caminho, { metodo = 'GET', corpo, token, tempo = 20000 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const relogio = ctl && setTimeout(() => ctl.abort(), tempo);
  let resp;
  try {
    resp = await fetch(API_URL + caminho, {
      method: metodo,
      headers: {
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctl?.signal,
    });
  } catch {
    clearTimeout(relogio);
    throw Object.assign(new Error('instabilidade'), { status: 0, codigo: 'instabilidade', dados: {} });
  }
  const dados = await resp.json().catch(() => ({})); // o relógio vale também para a leitura da resposta
  clearTimeout(relogio);
  if (ctl?.signal.aborted) throw Object.assign(new Error('instabilidade'), { status: 0, codigo: 'instabilidade', dados: {} });
  if (!resp.ok) {
    const codigo = resp.status >= 500 ? 'instabilidade' : dados.erro;
    throw Object.assign(new Error(codigo || 'falha'), { status: resp.status, codigo, dados });
  }
  return dados;
}

// Arquivos do app sempre a partir da raiz do site. Assim o app funciona em
// qualquer endereço — inclusive /app/<token> do ícone instalado pelo Husky.
const daRaiz = (p) => (!p || /^(https?:)?\/\//.test(p) ? p : (p.startsWith('/') ? p : 'https://app.mundopequenogenio.com/' + p));
function normalizarConteudo(c) {
  if (!c) return c;
  return {
    ...c,
    banners: (c.banners || []).map((b) => ({ ...b, imagem: daRaiz(b.imagem) })),
    produtos: c.produtos.map((p) => ({ ...p, imagem: daRaiz(p.imagem), aulas: p.aulas.map((a) => ({ ...a, capa: daRaiz(a.capa) })) })),
  };
}

// Idioma da marca (marca.json → "idioma"). Sem valor = português.
// tr('texto em português', 'texto en español')
let ES = false;
const tr = (pt, es) => (ES ? es : pt);
// Vídeos da marca (marca.json → textos.video; v33, 03/11/2026): { "velocidade": 0.5, "sem_som": true } = o player do Panda
// já abre em 0,5x (parâmetro defaultSpeed; o menu vai de 0,5x a 2x) e com o volume zerado (mensagem {type:'volume'} do
// player). O aluno muda os dois pelo próprio player. No iPhone/iPad o volume não muda por código (regra da Apple).
let VIDEO = {};

function aplicarMarca(marca) {
  ES = marca.textos?.idioma === 'es';
  VIDEO = marca.textos?.video || {};
  document.documentElement.lang = ES ? 'es' : 'pt-BR';
  const raiz = document.documentElement.style;
  // logo_raio: arredondamento do logo da tela de login (ex.: "50%" = redondo)
  const mapa = { primaria: '--primaria', destaque: '--destaque', detalhe: '--detalhe', sucesso: '--sucesso', logo_raio: '--logo-raio' };
  for (const [k, v] of Object.entries(marca.cores || {})) if (mapa[k]) raiz.setProperty(mapa[k], v);
  document.title = marca.nome;
  const pasta = `/marcas/${marca.slug}/`;
  document.getElementById('manifest').href = pasta + 'manifest.webmanifest';
  document.getElementById('icone').href = pasta + 'icone-192.png';
  document.getElementById('icone-apple').href = pasta + 'icone-180.png';
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'apple-mobile-web-app-title';
  meta.content = marca.nome;
  document.head.appendChild(meta);
}

function useRota() {
  const ler = () => location.hash.replace(/^#/, '') || '/';
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const posicoes = {};
    let atual = ler();
    const mudar = () => {
      posicoes[atual] = window.scrollY;
      atual = ler();
      setRota(atual);
      // volta para onde o aluno estava (ex.: lista de aulas) ou para o topo
      requestAnimationFrame(() => window.scrollTo(0, posicoes[atual] || 0));
    };
    window.addEventListener('hashchange', mudar);
    return () => window.removeEventListener('hashchange', mudar);
  }, []);
  return rota;
}

// ---------------------------------------------------------------------------
// instalar como aplicativo (ícone na tela do celular)
// ---------------------------------------------------------------------------

// Android/Chrome avisam que dá para instalar; guardamos o aviso para o botão usar.
let pedidoInstalacao = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoInstalacao = e;
  window.dispatchEvent(new Event('instalacao-mudou'));
});
window.addEventListener('appinstalled', () => {
  pedidoInstalacao = null;
  guardar.salvar('aparelho:instalou', Date.now()); // vai junto no próximo registro do aparelho
  window.dispatchEvent(new Event('instalacao-mudou'));
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});

const ua = navigator.userAgent;
const ehIphone = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Navegadores de dentro de apps (Instagram, Facebook, TikTok...) não instalam.
const ehNavegadorDeApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|musical_ly|BytedanceWebview|TikTok|Line\//i.test(ua);
const ehChromeIphone = /CriOS|FxiOS|EdgiOS/.test(ua);
// Computador: sem tela de toque e sem sistema de celular/tablet.
const ehComputador = !ehIphone && !/Android|Mobi|Tablet/i.test(ua) && window.matchMedia('(pointer: fine)').matches;
const ondeFicaIcone = () =>
  ehComputador ? tr('na área de trabalho do seu computador', 'en el escritorio de tu computadora') : tr('na tela do seu celular', 'en la pantalla de tu celular');
const jaInstalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------------------------------------------------------------------------
// De onde o aluno abriu o app (17/10/2026). Cada canal tem um endereço próprio, com cara de página do site:
//   /clientes → Instagram · /acesso → Facebook · /bem-vindo → redirecionamento do checkout (página do upsell)
//   /conteudo → WhatsApp · /material → e-mail · ?origem=<nome> também vale.
// Sem isso: notificação (o service worker manda ?origem=notificacao), ícone instalado, navegador do
// Instagram/Facebook, site de onde veio ou "direto". O endereço é limpo na hora (fica só o domínio),
// para não aparecer na barra e não contar de novo se a pessoa salvar o link.
// A PRIMEIRA origem fica guardada até o login (a pessoa pode abrir pelo /bem-vindo e só entrar depois, por outro link).
// ---------------------------------------------------------------------------
// marcas em espanhol (Hotmart): /clientes · /acceso · /bienvenido · /contenido · /material
const CAMINHOS_ORIGEM = { clientes: 'instagram', acesso: 'facebook', 'bem-vindo': 'checkout', conteudo: 'whatsapp', material: 'email',
  acceso: 'facebook', bienvenido: 'checkout', contenido: 'whatsapp' };
const ORIGENS = ['checkout', 'whatsapp', 'email', 'instagram', 'facebook', 'notificacao', 'icone', 'direto'];
const PRAZO_ORIGEM = 30 * 24 * 3600 * 1000;
const ORIGEM_ABERTURA = (() => {
  let origem = null;
  try {
    const url = new URL(location.href);
    const caminho = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const pedida = (url.searchParams.get('origem') || '').toLowerCase();
    origem = CAMINHOS_ORIGEM[caminho] || (ORIGENS.includes(pedida) ? pedida : null);
    if (!origem && jaInstalado()) origem = 'icone';
    if (!origem && /Instagram/i.test(ua)) origem = 'instagram';
    if (!origem && /FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) origem = 'facebook';
    if (!origem && document.referrer) {
      const ref = new URL(document.referrer).hostname;
      if (/instagram\./i.test(ref)) origem = 'instagram';
      else if (/facebook\.|fb\.me|messenger\./i.test(ref)) origem = 'facebook';
      else if (/mail\.|outlook\.|yahoo\./i.test(ref)) origem = 'email';
      else if (/checkout|vega|hotmart|pay\./i.test(ref)) origem = 'checkout';
    }
    // limpa o endereço: tira o caminho do canal e o ?origem (mantém ?marca, usado nos testes)
    if (CAMINHOS_ORIGEM[caminho] || url.searchParams.has('origem')) {
      url.searchParams.delete('origem');
      history.replaceState(null, '', '/' + url.search + url.hash);
    }
  } catch { /* endereço estranho: segue como "direto" */ }
  origem = origem || 'direto';
  // guarda para o login a PRIMEIRA origem (para o upsell vale o 1º acesso depois da compra): uma abertura depois
  // não substitui; só ocupa o lugar de um "direto" ou de uma origem com mais de 30 dias (alguém que nunca fez login)
  // (só para quem ainda não entrou: quem já está logado registra a abertura direto no servidor)
  const logado = !!guardar.ler('sessao:' + marcaDaUrl());
  const pendente = guardar.ler('origem:pendente');
  const vencida = !pendente || !ORIGENS.includes(pendente.o) || Date.now() - pendente.t > PRAZO_ORIGEM;
  if (!logado && (vencida || (pendente.o === 'direto' && origem !== 'direto'))) guardar.salvar('origem:pendente', { o: origem, t: Date.now() });
  return origem;
})();
// Origem para mandar no login: a primeira guardada (até 30 dias), senão a desta abertura.
function origemDoLogin() {
  const p = guardar.ler('origem:pendente');
  return p && Date.now() - p.t < PRAZO_ORIGEM && ORIGENS.includes(p.o) ? p.o : ORIGEM_ABERTURA;
}
let entrouAgora = false; // a abertura logo depois do login não conta de novo (o login já registrou)

// ---------------------------------------------------------------------------
// aparelho e avisos (App 2.0): sistema, navegador, se está instalado e a inscrição das notificações.
// Vai para o Supabase (app-api /aparelho) a cada abertura. No iPhone, o app instalado tem armazenamento
// separado do Safari: vira outro "aparelho", já com instalado = true.
// ---------------------------------------------------------------------------

function idAparelho() {
  let id = guardar.ler('aparelho:id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    guardar.salvar('aparelho:id', id);
  }
  return id;
}

function sistemaENavegador() {
  let sistema = 'outro', versao = null;
  if (ehIphone) { sistema = 'ios'; const m = ua.match(/OS (\d+)[._](\d+)/); versao = m && `${m[1]}.${m[2]}`; }
  else if (/Android/i.test(ua)) { sistema = 'android'; versao = (ua.match(/Android (\d+(\.\d+)?)/) || [])[1] || null; }
  else if (/CrOS/.test(ua)) sistema = 'chromeos';
  else if (/Windows/.test(ua)) sistema = 'windows';
  else if (/Macintosh|Mac OS X/.test(ua)) sistema = 'macos';
  else if (/Linux/.test(ua)) sistema = 'linux';
  const navegador = /Instagram/.test(ua) ? 'instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS|Messenger/.test(ua) ? 'facebook'
    : /musical_ly|BytedanceWebview|TikTok/i.test(ua) ? 'tiktok'
    : /SamsungBrowser/.test(ua) ? 'samsung'
    : /EdgA|EdgiOS|Edg\//.test(ua) ? 'edge'
    : /OPR\/|OPT\/|Opera/.test(ua) ? 'opera'
    : /FxiOS|Firefox\//.test(ua) ? 'firefox'
    : /CriOS|Chrome\//.test(ua) ? 'chrome'
    : /Safari\//.test(ua) ? 'safari' : 'outro';
  return { sistema, versao_sistema: versao, navegador };
}

// O aparelho aceita notificações? (iPhone: só com o app instalado, iOS 16.4+; Instagram/Facebook: não)
const avisosSuportados = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const permissaoAvisos = () => ('Notification' in window ? Notification.permission : null);

const deB64url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));

// Inscrição de avisos deste aparelho (cria se a permissão já foi dada). null = não recebe.
async function inscricaoAvisos(criar) {
  if (!avisosSuportados() || permissaoAvisos() !== 'granted' || !VAPID_PUBLICA) return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const nossa = deB64url(VAPID_PUBLICA);
  const atual = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
  if (sub && atual && (atual.length !== nossa.length || atual.some((b, i) => b !== nossa[i]))) {
    await sub.unsubscribe(); // inscrição de outro sistema (ex.: área antiga): troca pela nossa
    sub = null;
  }
  if (!sub && criar) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: nossa });
  if (!sub) return null;
  const j = sub.toJSON();
  return { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth };
}

// Manda o estado do aparelho. extra: {abertura, cartao}. Nunca atrapalha o app se falhar.
async function informarAparelho(token, extra = {}) {
  try {
    const p = {
      id: idAparelho(), ...sistemaENavegador(), instalado: jaInstalado(), push_suportado: avisosSuportados(),
      permissao: permissaoAvisos(), ...extra,
    };
    if (guardar.ler('aparelho:instalou')) p.instalou_pelo_botao = true;
    // Android com Chrome atual: a versão real do sistema não vem mais no userAgent
    if (p.sistema === 'android' && navigator.userAgentData?.getHighEntropyValues) {
      const v = await navigator.userAgentData.getHighEntropyValues(['platformVersion']).catch(() => null);
      if (v?.platformVersion) p.versao_sistema = v.platformVersion.split('.').slice(0, 2).join('.');
    }
    // a inscrição pode travar em alguns navegadores: depois de 10 s, manda o resto sem mexer nos avisos
    if (avisosSuportados()) {
      const push = await Promise.race([inscricaoAvisos(true).catch(() => null), new Promise((ok) => setTimeout(() => ok(undefined), 10000))]);
      if (push !== undefined) p.push = push;
    }
    await api('/aparelho', { metodo: 'POST', corpo: p, token });
    if (p.instalou_pelo_botao) guardar.apagar('aparelho:instalou');
  } catch { /* sem internet ou sessão expirada: tenta na próxima abertura */ }
}

const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const primeiroNome = (nome) => (nome || '').trim().split(/\s+/)[0] || '';

// Progresso fica no aparelho: { vistas: {aulaId: timestamp}, ultima: aulaId }
function useProgresso(chave) {
  const vazio = { vistas: {}, ultima: null };
  const [prog, setProg] = useState(() => guardar.ler(chave) || vazio);
  useEffect(() => setProg(guardar.ler(chave) || vazio), [chave]); // outro aluno entrou
  const marcarVista = (aulaId) =>
    setProg((p) => {
      const novo = { vistas: { ...p.vistas, [aulaId]: p.vistas[aulaId] || Date.now() }, ultima: aulaId };
      guardar.salvar(chave, novo);
      return novo;
    });
  return [prog, marcarVista];
}

// ---------------------------------------------------------------------------
// ícones (inline, sem dependências)
// ---------------------------------------------------------------------------

const Icone = {
  busca: html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>`,
  voltar: html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>`,
  seta: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg>`,
  cadeado: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>`,
  computador: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>`,
  instalarPc: html`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1b1b2b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 7v6M9.5 10.5L12 13l2.5-2.5M8 20h8" /></svg>`,
  celular: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>`,
  // ícones iguais aos do iPhone, para a pessoa reconhecer na tela
  compartilharIos: html`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></svg>`,
  adicionarIos: html`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1b1b2b" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></svg>`,
  maisVerde: html`<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#34c759" /><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.4" stroke-linecap="round" /></svg>`,
  tresPontos: html`<svg width="26" height="26" viewBox="0 0 24 24" fill="#1b1b2b"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>`,
  menuAndroid: html`<svg width="26" height="26" viewBox="0 0 24 24" fill="#1b1b2b"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>`,
  check: html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`,
  play: html`<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>`,
  baixar: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11" /><path d="M7 10.5l5 5 5-5" /><path d="M5 20h14" /></svg>`,
  pdf: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>`,
};

// ---------------------------------------------------------------------------
// telas
// ---------------------------------------------------------------------------

const MENSAGENS_LOGIN = {
  email_invalido: ['Digite um e-mail válido.', 'Escribe un correo electrónico válido.'],
  muitas_tentativas: [
    'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
    'Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.',
  ],
  instabilidade: [
    'Estamos com uma instabilidade no momento. Tente de novo em alguns minutos.',
    'Estamos con una inestabilidad en este momento. Inténtalo de nuevo en unos minutos.',
  ],
};
const mensagem = (lista, codigo, padrao) => (lista[codigo] ? tr(...lista[codigo]) : padrao);

function Login({ marca, aoEntrar }) {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar() {
    setErro('');
    setEnviando(true);
    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo || !emailLimpo.includes('@')) {
      setErro(tr('Digite um e-mail válido.', 'Escribe un correo electrónico válido.'));
      setEnviando(false);
      return;
    }
    // Acesso liberado com qualquer e-mail (área espelhada / TikTok).
    const nome = emailLimpo
      .split('@')[0]
      .replace(/[._+-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Aluno';
    aoEntrar({
      token: 'guest:' + emailLimpo,
      aluno: { nome, email: emailLimpo },
    });
  }
  function enviar(ev) {
    ev.preventDefault();
    entrar();
  }

  return html`
    <div class="login">
      <div class="login-cartao">
        <img class="login-logo" src=${marca.logo_url} alt=${marca.nome} width="168" height="168" />
        <h1>${tr('Área de Membros', 'Área de Miembros')}</h1>
        <p class="sub">${tr('Digite o e-mail que você usou na compra para acessar seus conteúdos.', 'Escribe el correo electrónico que usaste en la compra para acceder a tus contenidos.')}</p>
        <form onSubmit=${enviar}>
          <label for="email">${tr('Seu e-mail', 'Tu correo electrónico')}</label>
          <input
            id="email" class="campo" type="email" inputmode="email" autocomplete="email"
            placeholder=${tr('seuemail@exemplo.com', 'tucorreo@ejemplo.com')} required value=${email}
            onInput=${(e) => { setEmail(e.currentTarget.value); setErro(''); }}
          />
          ${erro && html`<div class="aviso-erro" role="alert">${erro}</div>`}
          <button class="botao bloco" disabled=${enviando}>${enviando ? tr('Entrando…', 'Entrando…') : tr('Entrar', 'Entrar')}</button>
        </form>
        <${InstalarApp} marca=${marca} />
      </div>
    </div>
  `;
}

// Botão "Instalar aplicativo" (só na tela de login).
// Android/Chrome: abre a janela oficial de instalação.
// iPhone: a Apple não permite instalar por botão → passo a passo com os ícones dela.
// Instagram/Facebook/TikTok: não instalam → ensina a abrir no navegador.
function InstalarApp({ marca }) {
  const [, atualizar] = useState(0);
  const [tutorial, setTutorial] = useState(null); // 'iphone' | 'android' | 'app' | 'pronto'
  useEffect(() => {
    const mudou = () => atualizar((n) => n + 1);
    window.addEventListener('instalacao-mudou', mudou);
    return () => window.removeEventListener('instalacao-mudou', mudou);
  }, []);
  if (jaInstalado()) return null;

  async function instalar() {
    if (ehNavegadorDeApp) return setTutorial('app');
    if (pedidoInstalacao) {
      pedidoInstalacao.prompt();
      const { outcome } = await pedidoInstalacao.userChoice;
      pedidoInstalacao = null;
      if (outcome === 'accepted') setTutorial('pronto');
      return;
    }
    setTutorial(ehIphone ? 'iphone' : 'android');
  }

  return html`
    <div class="instalar">
      <button class="botao secundario bloco botao-instalar" onClick=${instalar}>
        ${ehComputador ? Icone.computador : Icone.celular} ${tr('Instalar aplicativo', 'Instalar aplicación')}
      </button>
      <small>${tr(`Coloque o ícone do ${marca.nome} ${ondeFicaIcone()}.`, `Pon el ícono de ${marca.nome} ${ondeFicaIcone()}.`)}</small>
    </div>
    <${TutorialInstalacao} tipo=${tutorial} marca=${marca} aoFechar=${() => setTutorial(null)} />
  `;
}

function Passo({ n, children }) {
  return html`<li class="passo"><span class="passo-n">${n}</span><div>${children}</div></li>`;
}

function TutorialInstalacao({ tipo, marca, aoFechar }) {
  const ref = useRef();
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (tipo) {
      d?.showModal?.();
      // Abre no começo (passo 1), não rolado até o botão "Entendi".
      d?.querySelector('h2')?.focus();
      if (d) d.scrollTop = 0;
    } else d?.close?.();
    setCopiado(false);
  }, [tipo]);

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(location.origin + location.pathname);
      setCopiado(true);
    } catch { /* sem permissão: a pessoa segue pelas instruções */ }
  }

  let conteudo = null;
  if (tipo === 'pronto') {
    conteudo = ES
      ? html`
          <h2 tabindex="-1">¡Listo! 🎉</h2>
          <p class="tutorial-sub">El ícono de <strong>${marca.nome}</strong> ya está ${ehComputador ? 'en tu computadora' : 'en la pantalla de tu celular'}. Solo ${ehComputador ? 'haz clic' : 'toca'} en él para entrar.</p>
        `
      : html`
          <h2 tabindex="-1">Pronto! 🎉</h2>
          <p class="tutorial-sub">O ícone do <strong>${marca.nome}</strong> foi para ${ehComputador ? 'o seu computador' : 'a tela do seu celular'}. É só ${ehComputador ? 'clicar' : 'tocar'} nele para entrar.</p>
        `;
  } else if (tipo === 'app' && ES) {
    conteudo = html`
      <h2 tabindex="-1">Primero ábrelo en el navegador</h2>
      <p class="tutorial-sub">Desde Instagram no se puede instalar. Hazlo así:</p>
      <ol class="passos">
        <${Passo} n="1">Toca los <strong>tres puntitos</strong> en la esquina de arriba de la pantalla.
          <span class="icone-exemplo">${ehIphone ? Icone.tresPontos : Icone.menuAndroid}</span><//>
        <${Passo} n="2">Elige <strong>${ehIphone ? '“Abrir en navegador externo”' : '“Abrir en Chrome”'}</strong>${' '}(o “Abrir en el navegador”).<//>
        <${Passo} n="3">En la página que se abra, toca de nuevo <strong>“Instalar aplicación”</strong>.<//>
      </ol>
      <button class="botao secundario bloco" onClick=${copiarLink}>
        ${copiado ? '✓ ¡Enlace copiado! Pégalo en el navegador' : 'Copiar el enlace de la página'}
      </button>
    `;
  } else if (tipo === 'app') {
    conteudo = html`
      <h2 tabindex="-1">Abra no navegador primeiro</h2>
      <p class="tutorial-sub">Por dentro do Instagram não dá para instalar. Faça assim:</p>
      <ol class="passos">
        <${Passo} n="1">Toque nos <strong>três pontinhos</strong> no canto de cima da tela.
          <span class="icone-exemplo">${ehIphone ? Icone.tresPontos : Icone.menuAndroid}</span><//>
        <${Passo} n="2">Escolha <strong>${ehIphone ? '“Abrir no navegador externo”' : '“Abrir no Chrome”'}</strong>${' '}(ou “Abrir no navegador”).<//>
        <${Passo} n="3">Na página que abrir, toque de novo em <strong>“Instalar aplicativo”</strong>.<//>
      </ol>
      <button class="botao secundario bloco" onClick=${copiarLink}>
        ${copiado ? '✓ Link copiado! Cole no navegador' : 'Copiar o link da página'}
      </button>
    `;
  } else if (tipo === 'iphone' && ES) {
    conteudo = html`
      <h2 tabindex="-1">Instalar en iPhone</h2>
      <p class="tutorial-sub">Son 3 pasos rapiditos:</p>
      <ol class="passos">
        <${Passo} n="1">
          Toca el botón <strong>Compartir</strong>
          <span class="icone-exemplo">${Icone.compartilharIos}</span>
          ${ehChromeIphone
            ? html`<small>Está arriba, al lado de la dirección de la página.</small>`
            : html`<small>Está en la barra de abajo de la pantalla. Si no aparece, toca una vez la parte de abajo de la pantalla.</small>`}
        <//>
        <${Passo} n="2">
          Desliza la lista hacia arriba y toca <strong>“Agregar a inicio”</strong>
          <span class="icone-exemplo">${Icone.adicionarIos}</span>
          <div class="nao-aparece">
            <strong>¿No aparece esa opción?</strong>
            <ol>
              <li>Ve al final de la lista y toca <strong>“Editar acciones…”</strong></li>
              <li>Busca <strong>“Agregar a inicio”</strong> y toca el <span class="icone-mini">${Icone.maisVerde}</span> verde a su lado</li>
              <li>Toca <strong>“OK”</strong> (o “Listo”): ahora la opción aparece en la lista</li>
            </ol>
          </div>
        <//>
        <${Passo} n="3">Toca <strong>“Agregar”</strong>, arriba. ¡Listo: el ícono aparece en la pantalla del celular!<//>
      </ol>
      <p class="tutorial-nota">La primera vez que lo abras desde el ícono, solo escribe tu correo de nuevo.</p>
    `;
  } else if (tipo === 'android' && ehComputador && ES) {
    conteudo = html`
      <h2 tabindex="-1">Instalar en la computadora</h2>
      <ol class="passos">
        <${Passo} n="1">En <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>, haz clic en el ícono de instalar al final de la barra de direcciones
          <span class="icone-exemplo">${Icone.instalarPc}</span>
          <small>Si no aparece, haz clic en los tres puntitos del navegador y busca “Instalar…” (en Edge: “Aplicaciones” → “Instalar este sitio como una aplicación”).</small><//>
        <${Passo} n="2">Haz clic en <strong>“Instalar”</strong>. El ícono aparece en el escritorio y en el menú Inicio.<//>
      </ol>
      <p class="tutorial-nota">En Mac con Safari: menú <strong>Archivo</strong> → <strong>“Agregar al Dock”</strong>.</p>
    `;
  } else if (tipo === 'android' && !ehComputador && ES) {
    conteudo = html`
      <h2 tabindex="-1">Instalar en el celular</h2>
      <ol class="passos">
        <${Passo} n="1">Toca los <strong>tres puntitos</strong> en la esquina de arriba del navegador.
          <span class="icone-exemplo">${Icone.menuAndroid}</span><//>
        <${Passo} n="2">Toca <strong>“Instalar aplicación”</strong> o <strong>“Agregar a la pantalla principal”</strong>.<//>
        <${Passo} n="3">Confirma en <strong>“Instalar”</strong> o <strong>“Agregar”</strong>. El ícono aparece en la pantalla del celular.<//>
      </ol>
      <p class="tutorial-nota">Si ya lo instalaste antes, busca el ícono de ${marca.nome} en la pantalla del celular.</p>
    `;
  } else if (tipo === 'iphone') {
    conteudo = html`
      <h2 tabindex="-1">Instalar no iPhone</h2>
      <p class="tutorial-sub">São 3 passos rapidinhos:</p>
      <ol class="passos">
        <${Passo} n="1">
          Toque no botão <strong>Compartilhar</strong>
          <span class="icone-exemplo">${Icone.compartilharIos}</span>
          ${ehChromeIphone
            ? html`<small>Fica no canto de cima, ao lado do endereço da página.</small>`
            : html`<small>Fica na barra de baixo da tela. Se não aparecer, toque uma vez na parte de baixo da tela.</small>`}
        <//>
        <${Passo} n="2">
          Arraste a lista para cima e toque em <strong>“Adicionar à Tela de Início”</strong>
          <span class="icone-exemplo">${Icone.adicionarIos}</span>
          <div class="nao-aparece">
            <strong>Não aparece essa opção?</strong>
            <ol>
              <li>Vá até o final da lista e toque em <strong>“Editar Ações…”</strong></li>
              <li>Procure <strong>“Adicionar à Tela de Início”</strong> e toque no <span class="icone-mini">${Icone.maisVerde}</span> verde ao lado</li>
              <li>Toque em <strong>“OK”</strong> (ou “Concluído”) — agora a opção aparece na lista</li>
            </ol>
          </div>
        <//>
        <${Passo} n="3">Toque em <strong>“Adicionar”</strong>, no canto de cima. Pronto: o ícone aparece na tela do celular!<//>
      </ol>
      <p class="tutorial-nota">Na primeira vez que abrir pelo ícone, é só digitar seu e-mail de novo.</p>
    `;
  } else if (tipo === 'android' && ehComputador) {
    conteudo = html`
      <h2 tabindex="-1">Instalar no computador</h2>
      <ol class="passos">
        <${Passo} n="1">No <strong>Google Chrome</strong> ou no <strong>Microsoft Edge</strong>, clique no ícone de instalar no fim da barra de endereço
          <span class="icone-exemplo">${Icone.instalarPc}</span>
          <small>Se não aparecer, clique nos três pontinhos do navegador e procure “Instalar…” (no Edge: “Aplicativos” → “Instalar este site como aplicativo”).</small><//>
        <${Passo} n="2">Clique em <strong>“Instalar”</strong>. O ícone aparece na área de trabalho e no menu Iniciar.<//>
      </ol>
      <p class="tutorial-nota">No Mac com Safari: menu <strong>Arquivo</strong> → <strong>“Adicionar ao Dock”</strong>.</p>
    `;
  } else if (tipo === 'android') {
    conteudo = html`
      <h2 tabindex="-1">Instalar no celular</h2>
      <ol class="passos">
        <${Passo} n="1">Toque nos <strong>três pontinhos</strong> no canto de cima do navegador.
          <span class="icone-exemplo">${Icone.menuAndroid}</span><//>
        <${Passo} n="2">Toque em <strong>“Instalar aplicativo”</strong> ou <strong>“Adicionar à tela inicial”</strong>.<//>
        <${Passo} n="3">Confirme em <strong>“Instalar”</strong> ou <strong>“Adicionar”</strong>. O ícone aparece na tela do celular.<//>
      </ol>
      <p class="tutorial-nota">Se já instalou antes, procure o ícone do ${marca.nome} na tela do celular.</p>
    `;
  }

  return html`
    <dialog ref=${ref} class="tutorial" onClose=${aoFechar} onClick=${(e) => e.target === ref.current && aoFechar()}>
      ${conteudo && html`<div class="tutorial-corpo">${conteudo}<button class="botao bloco botao-grande" onClick=${aoFechar}>${tr('Entendi', 'Entendido')}</button></div>`}
    </dialog>
  `;
}

const formatarCpf = (v) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

const MENSAGENS_CPF = {
  cpf_invalido: 'CPF inválido. Confira os números e tente de novo.',
  nao_encontrado: 'Não encontramos nenhuma compra com este CPF. Confira os números ou fale com o suporte.',
  bloqueado:
    'Este cadastro já foi acessado ou já teve o e-mail corrigido. Por segurança, fale com o suporte para ajustar.',
  mesmo_email: 'Esse é o mesmo e-mail da compra. Digite o seu e-mail correto.',
  email_invalido: 'Digite um e-mail válido.',
  muitas_tentativas: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  instabilidade: 'Estamos com uma instabilidade no momento. Tente de novo em alguns minutos.',
  limite_aparelhos: 'Seu e-mail foi cadastrado, mas esta conta já está aberta no máximo de aparelhos. Volte para o login e entre com o e-mail novo para escolher o que fazer.',
};

// "Esqueci meu e-mail": CPF → e-mail mascarado → e-mail certo → entra.
function ErreiEmail({ marca, aoEntrar, aoVoltar }) {
  const [cpf, setCpf] = useState('');
  const [achados, setAchados] = useState(null); // e-mails mascarados
  const [email, setEmail] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [mostrarSuporte, setMostrarSuporte] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const falha = (codigo) => {
    setErro(MENSAGENS_CPF[codigo] || 'Não foi possível continuar agora. Verifique sua internet e tente de novo.');
    setMostrarSuporte(codigo === 'nao_encontrado' || codigo === 'bloqueado');
  };

  async function buscar(ev) {
    ev.preventDefault();
    setErro('');
    setMostrarSuporte(false);
    setEnviando(true);
    try {
      const r = await api('/cpf/buscar', { metodo: 'POST', corpo: { marca: marca.slug, cpf } });
      if (r.status === 'ok') setAchados(r.emails);
      else falha(r.status);
    } catch (e) {
      falha(e.codigo);
    }
    setEnviando(false);
  }

  async function salvar(ev) {
    ev.preventDefault();
    setErro('');
    if (email.trim().toLowerCase() !== confirma.trim().toLowerCase()) {
      setErro('Os dois e-mails não são iguais. Confira e digite de novo.');
      return;
    }
    setEnviando(true);
    try {
      aoEntrar(await api('/cpf/trocar', { metodo: 'POST', corpo: { marca: marca.slug, cpf, email, origem: origemDoLogin() } }));
    } catch (e) {
      falha(e.codigo);
      setEnviando(false);
    }
  }

  return html`
    <div class="login">
      <div class="login-cartao">
        <img class="login-logo pequena" src=${marca.logo_url} alt=${marca.nome} width="96" height="96" />
        <h1>Esqueci meu e-mail</h1>
        ${!achados
          ? html`
              <p class="sub">Informe o CPF que você usou no pagamento. Vamos encontrar sua compra para você cadastrar o e-mail certo.</p>
              <form onSubmit=${buscar}>
                <label for="cpf">CPF</label>
                <input
                  id="cpf" class="campo" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00"
                  required value=${cpf} onInput=${(e) => setCpf(formatarCpf(e.currentTarget.value))}
                />
                ${erro && html`<div class="aviso-erro" role="alert">${erro}</div>`}
                <button class="botao bloco" disabled=${enviando || cpf.replace(/\D/g, '').length !== 11}>
                  ${enviando ? 'Buscando…' : 'Buscar minha compra'}
                </button>
              </form>
            `
          : html`
              <div class="aviso-ok">
                Encontramos sua compra no e-mail:
                ${achados.map((m) => html`<strong>${m}</strong>`)}
              </div>
              <p class="sub">Digite abaixo o seu e-mail correto. É com ele que você vai entrar daqui em diante.</p>
              <form onSubmit=${salvar}>
                <label for="email-novo">E-mail correto</label>
                <input
                  id="email-novo" class="campo" type="email" inputmode="email" autocomplete="email" required
                  placeholder="seuemail@exemplo.com" value=${email} onInput=${(e) => { setEmail(e.currentTarget.value); setErro(''); }}
                />
                <label for="email-confirma">Confirme o e-mail correto</label>
                <input
                  id="email-confirma" class="campo" type="email" inputmode="email" autocomplete="off" required
                  placeholder="digite de novo" value=${confirma} onInput=${(e) => { setConfirma(e.currentTarget.value); setErro(''); }}
                  onPaste=${(e) => e.preventDefault()}
                />
                ${erro && html`<div class="aviso-erro" role="alert">${erro}</div>`}
                <button class="botao bloco" disabled=${enviando}>${enviando ? 'Salvando…' : 'Salvar e entrar'}</button>
              </form>
            `}
        ${mostrarSuporte && html`<${Suporte} marca=${marca} classe="ajuda" texto="Suporte:" />`}
        <button class="link-acao" onClick=${aoVoltar}>← Voltar para o login</button>
      </div>
    </div>
  `;
}

function Suporte({ marca, classe = '', texto = tr('Precisa de ajuda?', '¿Necesitas ayuda?') }) {
  const s = marca.suporte || {};
  const zap = (s.whatsapp || '').replace(/\D/g, '');
  if (!zap && !s.email) return null;
  return html`
    <div class=${classe}>
      ${texto}${' '}
      ${zap
        ? html`<a href=${'https://wa.me/' + zap} target="_blank" rel="noopener">${tr('Fale com o suporte no WhatsApp', 'Habla con soporte por WhatsApp')}</a>`
        : html`<a href=${'mailto:' + s.email}>${s.email}</a>`}
    </div>
  `;
}

// Barra fixa de voltar (produto e aula). O topo da marca rola junto com a página,
// mas esta barra fica sempre visível — pensado para quem tem pouca prática com celular.
function BarraVoltar({ href, rotulo, detalhe }) {
  return html`
    <div class="barra-voltar">
      <a href=${href}>
        <span class="seta-voltar">${Icone.voltar}</span>
        <span class="textos"><strong>${rotulo}</strong>${detalhe && html`<small>${detalhe}</small>`}</span>
      </a>
    </div>
  `;
}

function Topo({ marca, aoSair }) {
  return html`
    <header class="topo">
      <div class="container">
        <a class="topo-marca" href="#/">
          <img src=${marca.logo_url} alt="" width="42" height="42" />
          <span>${marca.nome}</span>
        </a>
        <div class="espaco"></div>
        <button class="botao-texto" onClick=${aoSair}>${tr('Sair', 'Salir')}</button>
      </div>
    </header>
  `;
}

function CartaoProduto({ produto, vistas, aoClicarBloqueado }) {
  const total = produto.total_aulas;
  if (!produto.liberado) {
    return html`
      <button class="produto-cartao bloqueado" onClick=${() => aoClicarBloqueado(produto)}>
        <div class="imagem">
          ${produto.imagem && html`<img src=${produto.imagem} alt="" loading="lazy" width="400" height="400" />`}
          <span class="cadeado">${Icone.cadeado}</span>
        </div>
        <div class="info">
          <strong>${produto.nome}</strong>
          <small>${plural(total, tr('conteúdo', 'contenido'), tr('conteúdos', 'contenidos'))}</small>
          <span class="selo-oferta">${produto.pagina_vendas ? tr('Preço de aluno', 'Precio de alumno') : tr('Desbloquear', 'Desbloquear')}</span>
        </div>
      </button>
    `;
  }
  const vistos = produto.aulas.filter((a) => vistas[a.id]).length;
  return html`
    <a class="produto-cartao" href=${'#/produto/' + produto.id}>
      <div class="imagem">
        ${produto.imagem && html`<img src=${produto.imagem} alt="" loading="lazy" width="400" height="400" />`}
      </div>
      <div class="info">
        <strong>${produto.nome}</strong>
        <small>${vistos > 0 ? `${vistos} de ${total} ${tr('vistos', 'vistos')}` : plural(total, tr('conteúdo', 'contenido'), tr('conteúdos', 'contenidos'))}</small>
        <div class="barra" aria-hidden="true"><i style=${{ width: (total ? (100 * vistos) / total : 0) + '%' }}></i></div>
      </div>
    </a>
  `;
}

// Cartão "Quer receber avisos?" (App 2.0), no topo da tela inicial.
//  - aparelho aceita avisos e ainda não respondeu → [Ativar avisos] abre a janela do próprio celular
//    (pedimos antes no cartão porque, se a pessoa recusar a janela do celular, o app nunca mais pode perguntar);
//  - iPhone no Safari (sem o app instalado): o iPhone só manda avisos para o app instalado → ensina a instalar;
//  - "Agora não": volta em 7 dias, no máximo 3 vezes.
const ESPERA_CARTAO = 7 * 24 * 3600 * 1000;
function tipoCartaoAvisos() {
  const adiado = guardar.ler('avisos:adiado') || { ate: 0, vezes: 0 };
  if (adiado.vezes >= 3 || Date.now() < adiado.ate || ehNavegadorDeApp) return null;
  if (avisosSuportados()) return permissaoAvisos() === 'default' ? 'ativar' : null;
  if (ehIphone && !jaInstalado()) return 'instalar';
  return null;
}

function CartaoAvisos({ marca, token }) {
  const [tipo, setTipo] = useState(tipoCartaoAvisos);
  const [estado, setEstado] = useState(null); // null | 'pedindo' | 'ok' | 'negado'
  const [tutorial, setTutorial] = useState(null);
  useEffect(() => {
    if (tipo && !guardar.ler('avisos:cartao_visto')) {
      guardar.salvar('avisos:cartao_visto', Date.now());
      informarAparelho(token, { cartao: 'visto' });
    }
  }, []);
  if (!tipo && !estado) return null;

  async function ativar() {
    setEstado('pedindo');
    let resposta = 'default';
    try { resposta = await Notification.requestPermission(); } catch { /* navegador antigo */ }
    if (resposta === 'granted') {
      await informarAparelho(token); // cria a inscrição e salva
      setEstado('ok');
    } else {
      informarAparelho(token);
      setEstado(resposta === 'denied' ? 'negado' : null);
    }
    setTipo(null);
  }
  function agoraNao() {
    const a = guardar.ler('avisos:adiado') || { vezes: 0 };
    guardar.salvar('avisos:adiado', { ate: Date.now() + ESPERA_CARTAO, vezes: (a.vezes || 0) + 1 });
    informarAparelho(token, { cartao: 'agora_nao' });
    setTipo(null);
  }

  if (estado === 'ok' || estado === 'negado') {
    return html`
      <section class="cartao-avisos feito" role="status">
        <p>${estado === 'ok'
          ? tr('✅ Pronto! Você vai receber os avisos de novidades por aqui.', '✅ ¡Listo! Vas a recibir los avisos de novedades por aquí.')
          : tr('Tudo bem! Se mudar de ideia, dá para ativar os avisos nos ajustes do celular.', '¡Está bien! Si cambias de idea, puedes activar los avisos en los ajustes del celular.')}</p>
        <button class="botao-texto" onClick=${() => setEstado(null)}>${tr('Fechar', 'Cerrar')}</button>
      </section>
    `;
  }
  const instalar = tipo === 'instalar';
  return html`
    <section class="cartao-avisos">
      <div class="cartao-avisos-icone" aria-hidden="true">${instalar ? '📲' : '🔔'}</div>
      <div class="cartao-avisos-texto">
        <strong>${instalar ? tr('Instale o app e receba avisos', 'Instala la app y recibe avisos') : tr('Quer ser avisado das novidades?', '¿Quieres que te avisemos de las novedades?')}</strong>
        <p>${instalar
          ? tr(`Coloque o ícone do ${marca.nome} na tela do iPhone: fica mais fácil de entrar e você recebe um aviso quando tiver conteúdo novo.`,
               `Pon el ícono de ${marca.nome} en la pantalla del iPhone: es más fácil entrar y recibes un aviso cuando haya contenido nuevo.`)
          : tr(`Receba um aviso ${ehComputador ? 'no computador' : 'no celular'} quando tiver conteúdo novo para você.`,
               `Recibe un aviso ${ehComputador ? 'en la computadora' : 'en el celular'} cuando haya contenido nuevo para ti.`)}</p>
        <div class="cartao-avisos-botoes">
          <button class="botao" disabled=${estado === 'pedindo'} onClick=${instalar ? () => setTutorial('iphone') : ativar}>
            ${instalar ? tr('Ver como instalar', 'Ver cómo instalar') : estado === 'pedindo' ? tr('Aguarde…', 'Espera…') : tr('Ativar avisos', 'Activar avisos')}
          </button>
          <button class="botao secundario" onClick=${agoraNao}>${tr('Agora não', 'Ahora no')}</button>
        </div>
      </div>
    </section>
    ${instalar && html`<${TutorialInstalacao} tipo=${tutorial} marca=${marca} aoFechar=${() => setTutorial(null)} />`}
  `;
}

function Inicio({ marca, conteudo, prog, aoClicarBloqueado, token }) {
  const [busca, setBusca] = useState('');
  const liberados = conteudo.produtos.filter((p) => p.liberado);
  // bloqueados com página de pagamento (oferta) primeiro; os sem link (ex.: bônus) depois
  const bloqueados = conteudo.produtos.filter((p) => !p.liberado).sort((a, b) => !!b.pagina_vendas - !!a.pagina_vendas);
  // só fala em "preço de aluno" se algum bloqueado tem página de pagamento (senão seria uma promessa vazia)
  const temOferta = bloqueados.some((p) => p.pagina_vendas);

  const todasAulas = useMemo(
    () => liberados.flatMap((p) => p.aulas.map((a) => ({ ...a, produto: p, chave: semAcento(a.titulo) }))),
    [conteudo],
  );
  const ultima = prog.ultima && todasAulas.find((a) => a.id === prog.ultima);
  const termo = semAcento(busca.trim());
  const resultados = termo.length >= 2 ? todasAulas.filter((a) => a.chave.includes(termo)).slice(0, 60) : null;

  return html`
    <div class="container">
      <section class="saudacao">
        <h1>${tr('Olá', '¡Hola')}${conteudo.aluno?.nome ? ', ' + primeiroNome(conteudo.aluno.nome) : ''}! 👋</h1>
        <p>${tr('Que bom ter você aqui. Escolha um conteúdo para começar.', 'Qué bueno tenerte aquí. Elige un contenido para empezar.')}</p>
      </section>

      <${CartaoAvisos} marca=${marca} token=${token} />

      <div class="busca">
        ${Icone.busca}
        <input
          class="campo" type="search" placeholder=${marca.textos?.busca || tr('Buscar nos seus conteúdos…', 'Buscar en tus contenidos…')}
          aria-label=${tr('Buscar nos seus conteúdos', 'Buscar en tus contenidos')} value=${busca} onInput=${(e) => setBusca(e.currentTarget.value)}
        />
      </div>

      ${resultados
        ? html`
            <section class="secao">
              <div class="secao-titulo">
                <h2>${tr('Resultados', 'Resultados')}</h2>
                <span>${plural(resultados.length, tr('encontrado', 'encontrado'), tr('encontrados', 'encontrados'))}</span>
              </div>
              ${resultados.length === 0
                ? html`<p class="vazio">${tr('Nada encontrado para', 'No se encontró nada para')} “${busca}”.</p>`
                : html`<div class="resultados">
                    ${resultados.map(
                      (a) => html`
                        <a class="resultado" href=${'#/aula/' + a.id}>
                          <img src=${a.capa} alt="" loading="lazy" width="56" height="56" />
                          <div>
                            <strong>${a.titulo}</strong>
                            <small>${a.tipo === 'pdf' ? 'PDF' : tr('Vídeo', 'Video')} · ${a.produto.nome}</small>
                          </div>
                        </a>
                      `,
                    )}
                  </div>`}
            </section>
          `
        : html`
            ${ultima &&
            html`
              <section class="secao">
                <a class="continuar" href=${'#/aula/' + ultima.id}>
                  <img src=${ultima.capa} alt="" width="72" height="72" />
                  <div>
                    <small>${tr('Continue de onde parou', 'Continúa donde te quedaste')}</small>
                    <strong>${ultima.titulo}</strong>
                  </div>
                  <span class="seta">${Icone.seta}</span>
                </a>
              </section>
            `}

            <section class="secao">
              <div class="secao-titulo">
                <h2>${tr('Meus conteúdos', 'Mis contenidos')}</h2>
                <span>${plural(liberados.length, tr('produto', 'producto'), tr('produtos', 'productos'))}</span>
              </div>
              <div class="grade-produtos">
                ${liberados.map((p) => html`<${CartaoProduto} key=${p.id} produto=${p} vistas=${prog.vistas} />`)}
              </div>
            </section>

            ${bloqueados.length > 0 &&
            html`
              <section class="secao">
                <!-- textos que vendem: "preço especial porque já é aluno". A marca pode trocar no marca.json:
                     textos.ofertas_titulo / textos.ofertas_sub -->
                <div class="secao-titulo">
                  <h2>${temOferta
                    ? marca.textos?.ofertas_titulo || tr('🎁 Ofertas exclusivas para alunos', '🎁 Ofertas exclusivas para alumnos')
                    : tr('Mais conteúdos para você', 'Más contenidos para ti')}</h2>
                </div>
                ${temOferta && html`<p class="secao-sub">${marca.textos?.ofertas_sub || tr('Por já ser aluno, você libera estes materiais por um valor especial.', 'Por ser alumno, desbloqueas estos materiales a un precio especial.')}</p>`}
                <div class="grade-produtos">
                  ${bloqueados.map(
                    (p) => html`<${CartaoProduto} key=${p.id} produto=${p} aoClicarBloqueado=${aoClicarBloqueado} />`,
                  )}
                </div>
              </section>
            `}
          `}
    </div>
  `;
}

function Produto({ produto, prog }) {
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const tipos = new Set(produto.aulas.map((a) => a.tipo));
  const termo = semAcento(busca.trim());
  const aulas = produto.aulas.filter(
    (a) => (filtro === 'todos' || a.tipo === filtro) && (!termo || semAcento(a.titulo).includes(termo)),
  );
  const vistos = produto.aulas.filter((a) => prog.vistas[a.id]).length;
  const total = produto.aulas.length;

  return html`
    <div class="container">
      <${BarraVoltar} href="#/" rotulo=${tr('Voltar ao início', 'Volver al inicio')} />
      <div class="produto-topo">
        ${produto.imagem && html`<img src=${produto.imagem} alt="" width="120" height="120" />`}
        <div>
          <h1>${produto.nome}</h1>
          <div class="meta">${plural(total, tr('conteúdo', 'contenido'), tr('conteúdos', 'contenidos'))} · ${vistos} ${tr('vistos', 'vistos')}</div>
          <div class="barra" aria-hidden="true"><i style=${{ width: (total ? (100 * vistos) / total : 0) + '%' }}></i></div>
        </div>
      </div>

      ${total > 8 &&
      html`
        <div class="busca">
          ${Icone.busca}
          <input
            class="campo" type="search" placeholder=${tr('Buscar neste conteúdo…', 'Buscar en este contenido…')} aria-label=${tr('Buscar neste conteúdo', 'Buscar en este contenido')}
            value=${busca} onInput=${(e) => setBusca(e.currentTarget.value)}
          />
        </div>
      `}

      ${tipos.size > 1 &&
      html`
        <div class="filtros" role="group" aria-label=${tr('Filtrar por tipo', 'Filtrar por tipo')}>
          ${[['todos', tr('Todos', 'Todos')], ['video_panda', tr('Vídeos', 'Videos')], ['pdf', 'PDFs']].map(
            ([v, rotulo]) =>
              html`<button class="chip" aria-pressed=${filtro === v} onClick=${() => setFiltro(v)}>${rotulo}</button>`,
          )}
        </div>
      `}

      ${aulas.length === 0
        ? html`<p class="vazio">${tr('Nenhum conteúdo encontrado.', 'No se encontró ningún contenido.')}</p>`
        : // seções dentro do módulo (02/11/2026): conteúdos com "secao" ganham um título por seção, na ordem das aulas;
          // módulo sem seções continua uma lista única
          secoesDe(aulas).map(
            (g) => html`
              ${g.secao && html`<h2 class="secao-modulo" key=${'s-' + g.secao}>${g.secao} <small>${plural(g.aulas.length, tr('conteúdo', 'contenido'), tr('conteúdos', 'contenidos'))}</small></h2>`}
              <div class="grade-aulas">
              ${g.aulas.map(
                (a) => html`
                  <a class="aula-cartao" href=${'#/aula/' + a.id} key=${a.id}>
                    <div class="imagem">
                      <img src=${a.capa} alt="" loading="lazy" width="360" height="360" />
                      <span class="tipo">${a.tipo === 'pdf' ? html`${Icone.pdf} PDF` : html`${Icone.play} ${tr('Vídeo', 'Video')}`}</span>
                      ${prog.vistas[a.id] && html`<span class="visto" title=${tr('Visto', 'Visto')}>${Icone.check}</span>`}
                    </div>
                    <div class="info"><strong>${a.titulo}</strong></div>
                  </a>
                `,
              )}
              </div>`,
          )}
    </div>
  `;
}

// agrupa as aulas (já na ordem) em seções seguidas: [{ secao, aulas }]; sem seção = um grupo só, sem título
function secoesDe(aulas) {
  const grupos = [];
  for (const a of aulas) {
    const s = a.secao || '';
    if (!grupos.length || grupos[grupos.length - 1].secao !== s) grupos.push({ secao: s, aulas: [] });
    grupos[grupos.length - 1].aulas.push(a);
  }
  return grupos;
}

function Aula({ aula, produto, playerPanda, marcarVista, token, aoDerrubar }) {
  useEffect(() => marcarVista(aula.id), [aula.id]);
  // vídeo aberto: o servidor confere se a conta abre vídeos rápido demais (automação gastando o Panda); se sim, volta ao login
  useEffect(() => {
    if (aula.tipo !== 'video_panda' || !token) return;
    api('/aula', { metodo: 'POST', token, corpo: { aula: aula.id } }).catch((e) => { if (e.status === 401) aoDerrubar(); });
  }, [aula.id]);
  // sem som por padrão (textos.video.sem_som): zera o volume quando o player avisa que está pronto (e de novo em 1 s e 3 s)
  const playerRef = useRef();
  useEffect(() => {
    if (aula.tipo !== 'video_panda' || !VIDEO.sem_som) return;
    const zerar = () => { try { playerRef.current?.contentWindow?.postMessage({ type: 'volume', parameter: 0 }, '*'); } catch { /* player ainda carregando */ } };
    // num aparelho "limpo" o player às vezes se reconfigura depois do pronto: zera no pronto, no 1º canplay e no 1º play.
    // Cada um só uma vez (canplay volta ao avançar o vídeo) e nada depois do 1º play, para não desfazer o volume que o aluno subir.
    const vistos = new Set();
    const ouvir = (e) => {
      if (e.source !== playerRef.current?.contentWindow) return;
      const m = String(e.data?.message || e.data?.type || '').toLowerCase();
      if (!['panda_ready', 'panda_canplay', 'panda_play'].includes(m) || vistos.has(m) || (vistos.has('panda_play') && m !== 'panda_play')) return;
      vistos.add(m); zerar();
    };
    addEventListener('message', ouvir);
    const t1 = setTimeout(() => vistos.has('panda_play') || zerar(), 1000), t2 = setTimeout(() => vistos.has('panda_play') || zerar(), 3000);
    return () => { removeEventListener('message', ouvir); clearTimeout(t1); clearTimeout(t2); };
  }, [aula.id]);
  const velocidade = Number(VIDEO.velocidade) > 0 ? `&defaultSpeed=${Number(VIDEO.velocidade)}` : '';
  const i = produto.aulas.findIndex((a) => a.id === aula.id);
  const anterior = produto.aulas[i - 1];
  const proxima = produto.aulas[i + 1];
  const driveId = aula.url && (aula.url.match(/\/d\/([\w-]+)/) || [])[1];

  return html`
    <div class="container aula">
      <${BarraVoltar} href=${'#/produto/' + produto.id} rotulo=${tr('Voltar aos materiais', 'Volver a los materiales')} detalhe=${produto.nome} />
      <h1>${aula.titulo}</h1>
      <div class="aula-corpo">
        ${aula.tipo === 'video_panda'
          ? html`
              <div class="player">
                <iframe
                  key=${aula.id}
                  ref=${playerRef}
                  src=${`${playerPanda}/embed/?v=${aula.panda_id}${velocidade}`}
                  title=${aula.titulo}
                  allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;fullscreen"
                  allowfullscreen
                ></iframe>
              </div>
            `
          : html`
              <!-- O PDF é lido aqui mesmo; o botão é só para salvar ou imprimir. -->
              <a class="botao bloco botao-grande" href=${aula.url} target="_blank" rel="noopener">
                ${Icone.baixar} ${tr('Salvar/Imprimir PDF', 'Guardar/Imprimir PDF')}
              </a>
              ${driveId &&
              html`<iframe
                key=${aula.id}
                class="pdf-previa"
                src=${`https://drive.google.com/file/d/${driveId}/preview`}
                title=${aula.titulo}
                allow="fullscreen"
              ></iframe>`}
            `}
        ${aula.texto && html`<div class="texto-apoio" dangerouslySetInnerHTML=${{ __html: aula.texto }}></div>`}
      </div>

      <nav class="navegacao" aria-label=${tr('Navegar entre conteúdos', 'Navegar entre contenidos')}>
        ${anterior
          ? html`<a href=${'#/aula/' + anterior.id}><small>← ${tr('Anterior', 'Anterior')}</small><span>${anterior.titulo}</span></a>`
          : html`<span></span>`}
        ${proxima && html`<a class="prox" href=${'#/aula/' + proxima.id}><small>${tr('Próximo', 'Siguiente')} →</small><span>${proxima.titulo}</span></a>`}
      </nav>
    </div>
  `;
}

function DialogoBloqueado({ produto, marca, aoFechar }) {
  const ref = useRef();
  useEffect(() => {
    if (produto) ref.current?.showModal?.();
    else ref.current?.close?.();
  }, [produto]);
  const link = produto?.pagina_vendas;
  return html`
    <dialog ref=${ref} onClose=${aoFechar} onClick=${(e) => e.target === ref.current && aoFechar()}>
      ${produto &&
      html`
        <div class="dialogo">
          ${produto.imagem && html`<img src=${produto.imagem} alt="" width="140" height="140" />`}
          <h2>${produto.nome}</h2>
          <p>${link
            ? tr('Como você já é aluno, pode liberar este material por um valor especial, só para quem já faz parte da área de membros.',
                 'Como ya eres alumno, puedes desbloquear este material a un precio especial, solo para quien ya forma parte del área de miembros.')
            : tr('Este conteúdo ainda não faz parte do seu acesso.', 'Este contenido todavía no forma parte de tu acceso.')}</p>
          ${link
            ? html`<a class="botao bloco" href=${link} target="_blank" rel="noopener">${tr('Quero aproveitar', 'Quiero aprovecharlo')}</a>`
            : html`<${Suporte} marca=${marca} texto=${tr('Quer desbloquear?', '¿Quieres desbloquearlo?')} />`}
          <button class="botao secundario bloco" onClick=${aoFechar}>${tr('Agora não', 'Ahora no')}</button>
        </div>
      `}
    </dialog>
  `;
}

// Pop-up de oferta (App 2.0, fase 2). O conteúdo vem todo do painel (página "Instalação e avisos"):
// imagem, título, texto, botão e destino (página de pagamento, outro link ou uma tela do app).
// O banco escolhe qual pop-up (e se algum) este aluno vê agora; o app só mostra e conta visto/clicou/fechou.
// **assim** no título ou no texto vira negrito (sem innerHTML: o texto do banco nunca vira HTML).
const comNegrito = (t) => String(t || '').split(/\*\*(.+?)\*\*/s).map((p, i) => (i % 2 ? html`<strong>${p}</strong>` : p));

function PopupOferta({ oferta, token, aoFechar }) {
  const ref = useRef();
  const evento = (tipo) =>
    api('/oferta/evento', { metodo: 'POST', corpo: { oferta: oferta.id, produto: oferta.produto, tipo }, token }).catch(() => {});
  useEffect(() => {
    ref.current?.showModal?.();
    evento('visto');
  }, []);
  const externo = /^https:\/\//.test(oferta.link || '');
  function fechar() { evento('fechou'); ref.current?.close?.(); aoFechar(); }
  function clicar() {
    evento('clicou');
    ref.current?.close?.();
    aoFechar();
    if (!externo) location.hash = oferta.link || '#/'; // link de fora abre pelo próprio <a> (nova aba)
  }
  return html`
    <dialog ref=${ref} class="popup-oferta" onCancel=${(e) => { e.preventDefault(); fechar(); }} onClick=${(e) => e.target === ref.current && fechar()}>
      <div class="dialogo">
        ${oferta.imagem && html`<img src=${daRaiz(oferta.imagem)} alt="" width="220" height="220" />`}
        <h2>${comNegrito(oferta.titulo)}</h2>
        ${oferta.texto && html`<p>${comNegrito(oferta.texto)}</p>`}
        <a class="botao bloco botao-grande" href=${externo ? oferta.link : '#'} target=${externo ? '_blank' : undefined} rel="noopener"
          onClick=${(e) => { if (!externo) e.preventDefault(); clicar(); }}>${oferta.botao || tr('Quero aproveitar', 'Quiero aprovechar')}</a>
        <button class="botao secundario bloco" onClick=${fechar}>${tr('Agora não', 'Ahora no')}</button>
      </div>
    </dialog>
  `;
}

// Funcionalidades do App (02/11/2026): presente de Natal. O aluno ganhou um produto que não tem; Aceitar libera na hora
// (o servidor cria o acesso) e o conteúdo é relido; Recusar e fechar ficam registrados (o painel decide quando volta).
function PopupPresente({ item, token, aoFechar, aoAceitar }) {
  const ref = useRef();
  const [estado, setEstado] = useState(null); // null | 'enviando' | 'aceito' | 'erro'
  const acao = (tipo) => api('/funcionalidades/acao', { metodo: 'POST', corpo: { codigo: item.codigo, tipo }, token });
  useEffect(() => {
    ref.current?.showModal?.();
    acao('visto').catch(() => {});
  }, []);
  function fechar(tipo = 'fechou') {
    if (estado !== 'aceito') acao(tipo).catch(() => {});
    ref.current?.close?.();
    aoFechar();
  }
  function aceitar() {
    setEstado('enviando');
    acao('aceitou')
      .then((r) => { if (!r?.ok) throw new Error('nao_liberou'); setEstado('aceito'); aoAceitar(); })
      .catch(() => setEstado('erro'));
  }
  function ver() {
    ref.current?.close?.();
    aoFechar();
    location.hash = '#/produto/' + item.produto.id;
  }
  return html`
    <dialog ref=${ref} class="popup-oferta popup-presente" onCancel=${(e) => { e.preventDefault(); fechar(); }}
      onClick=${(e) => e.target === ref.current && fechar()}>
      <div class="dialogo">
        ${item.imagem && html`<img src=${daRaiz(item.imagem)} alt="" width="240" height="240" />`}
        ${estado === 'aceito'
          ? html`
              <h2>${comNegrito(item.aceito)}</h2>
              <button class="botao bloco botao-grande" onClick=${ver}>${tr('Ver meu presente', 'Ver mi regalo')}</button>
              <button class="botao secundario bloco" onClick=${() => fechar()}>${tr('Fechar', 'Cerrar')}</button>`
          : html`
              <h2>${comNegrito(item.titulo)}</h2>
              ${item.produto?.capa && html`<div class="presente-produto"><img src=${daRaiz(item.produto.capa)} alt="" width="56" height="56" /><strong>${item.produto.nome}</strong></div>`}
              ${item.texto && html`<p>${comNegrito(item.texto)}</p>`}
              ${estado === 'erro' && html`<p class="erro">${tr('Não conseguimos liberar agora. Tente de novo.', 'No pudimos liberarlo ahora. Inténtalo de nuevo.')}</p>`}
              <button class="botao bloco botao-grande" disabled=${estado === 'enviando'} onClick=${aceitar}>
                ${estado === 'enviando' ? tr('Liberando…', 'Liberando…') : item.botao_aceitar}</button>
              <button class="botao secundario bloco" disabled=${estado === 'enviando'} onClick=${() => fechar('recusou')}>${item.botao_recusar}</button>`}
      </div>
    </dialog>
  `;
}

// Roleta de cupons (Funcionalidades do App, 11/11/2026; roleta-cupons/ESCOPO.md). A roleta é só visual: as fatias vão até
// o desconto real e ela sempre para nele (o servidor decide). "Quero meu desconto" abre o checkout com o preço cortado;
// "Agora não" fecha. Sem validade: o desconto não fica guardado no app.
const CORES_ROLETA = ['#ff5a5f', '#ffb400', '#00a699', '#7b61ff', '#ff7ac6', '#2bb0ed', '#8bc34a', '#ff8a3d'];
function PopupRoleta({ item, token, aoFechar }) {
  const ref = useRef();
  const [fase, setFase] = useState('inicio'); // inicio | girando | resultado
  const [giro, setGiro] = useState(0);
  const acao = (tipo) => api('/funcionalidades/acao', { metodo: 'POST', corpo: { codigo: item.codigo, tipo }, token }).catch(() => {});
  const fatias = (item.fatias?.length ? item.fatias : [item.desconto]).map(Number);
  const n = fatias.length;
  const seg = 360 / n;
  const alvo = Math.max(0, fatias.indexOf(Number(item.desconto)));
  useEffect(() => {
    ref.current?.showModal?.();
    acao('visto');
  }, []);
  function fechar(tipo = 'fechou') {
    acao(tipo);
    ref.current?.close?.();
    aoFechar();
  }
  function girar() {
    if (fase !== 'inicio') return;
    // 6 voltas e para com o centro da fatia do desconto embaixo da seta (no topo); um pequeno desvio dá naturalidade
    const desvio = (Math.random() - 0.5) * seg * 0.5;
    setGiro(360 * 6 + (360 - (alvo + 0.5) * seg) + desvio);
    setFase('girando');
    setTimeout(() => setFase('resultado'), 4300);
  }
  function quero() {
    acao('aceitou');
    ref.current?.close?.();
    aoFechar(); // o link abre pelo próprio <a> (nova aba), sem bloqueio de pop-up
  }
  const fundo = 'conic-gradient(' + fatias.map((_, i) => `${CORES_ROLETA[i % CORES_ROLETA.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ') + ')';
  return html`
    <dialog ref=${ref} class="popup-oferta popup-roleta" onCancel=${(e) => { e.preventDefault(); if (fase !== 'girando') fechar(); }}
      onClick=${(e) => e.target === ref.current && fase !== 'girando' && fechar()}>
      <div class="dialogo">
        <h2>${comNegrito(fase === 'resultado' ? item.resultado : item.titulo)}</h2>
        ${fase !== 'resultado' && item.texto && html`<p>${comNegrito(item.texto)}</p>`}
        <div class=${'roleta' + (fase === 'resultado' ? ' parou' : '')} aria-hidden="true">
          <div class="roleta-seta"></div>
          <div class="roleta-disco" style=${{ background: fundo, transform: `rotate(${giro}deg)` }}>
            ${fatias.map((f, i) => html`<span class="roleta-rotulo" style=${{ transform: `rotate(${(i + 0.5) * seg}deg)` }}><b>${f}%</b></span>`)}
          </div>
          <div class="roleta-centro">${fase === 'resultado' ? item.desconto + '%' : '🎁'}</div>
        </div>
        ${fase === 'resultado' && html`
          <div class="presente-produto">
            ${item.produto?.capa && html`<img src=${daRaiz(item.produto.capa)} alt="" width="56" height="56" />`}
            <div><strong>${item.produto?.nome}</strong>
              ${item.preco_por && html`<div class="roleta-preco">${item.preco_de && html`<s>${item.preco_de}</s> `}<b>${item.preco_por}</b></div>`}</div>
          </div>`}
        ${fase === 'resultado'
          ? html`
              <a class="botao bloco botao-grande" href=${item.link} target="_blank" rel="noopener" onClick=${quero}>${item.botao_quero}</a>
              <button class="botao secundario bloco" onClick=${() => fechar('recusou')}>${item.botao_nao}</button>`
          : html`
              <button class="botao bloco botao-grande" disabled=${fase === 'girando'} onClick=${girar}>
                ${fase === 'girando' ? tr('Girando…', 'Girando…') : item.botao_girar}</button>
              ${fase === 'inicio' && html`<button class="botao secundario bloco" onClick=${() => fechar()}>${tr('Agora não', 'Ahora no')}</button>`}`}
      </div>
    </dialog>
  `;
}

// Banco fora ou lento (queda do Supabase de 24/10/2026): aviso em vez da tela em branco, com "Tentar de novo"
// e nova tentativa sozinha a cada 30 s. Sem marca (1ª abertura no aparelho), o idioma vem do navegador.
function Instabilidade({ marca, aoTentar }) {
  const [tentando, setTentando] = useState(false);
  const es = marca ? ES : /^es/i.test(navigator.language || '');
  const t = (pt, esp) => (es ? esp : pt);
  const tentar = () => {
    setTentando(true);
    Promise.resolve(aoTentar()).finally(() => setTentando(false));
  };
  useEffect(() => {
    const relogio = setInterval(tentar, 30000);
    return () => clearInterval(relogio);
  }, []);
  return html`
    <div class="login">
      <div class="login-cartao instabilidade" role="alert">
        ${marca ? html`<img class="login-logo pequena" src=${marca.logo_url} alt=${marca.nome} width="96" height="96" />`
          : html`<div class="instabilidade-icone" aria-hidden="true">⏳</div>`}
        <h1>${t('Estamos com uma instabilidade', 'Estamos con una inestabilidad')}</h1>
        <p class="sub">${t(
          'Nossos servidores estão lentos no momento. Seus conteúdos continuam guardados: tente de novo em alguns minutos.',
          'Nuestros servidores están lentos en este momento. Tus contenidos siguen guardados: inténtalo de nuevo en unos minutos.')}</p>
        <button class="botao bloco" disabled=${tentando} onClick=${tentar}>${tentando
          ? t('Tentando…', 'Intentando…') : t('Tentar de novo', 'Intentar de nuevo')}</button>
        <p class="instabilidade-auto">${t('O app tenta de novo sozinho a cada 30 segundos.', 'La app lo intenta de nuevo sola cada 30 segundos.')}</p>
        ${marca && html`<${Suporte} marca=${marca} classe="ajuda" texto=${t('Precisa de ajuda?', '¿Necesitas ayuda?')} />`}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

function App() {
  const slug = marcaDaUrl();
  const chaveSessao = `sessao:${slug}`;
  const chaveMarca = `marca:${slug}`;
  // A marca fica guardada no aparelho: com o banco lento ou fora, o app abre na hora (login ou conteúdo salvo)
  // e só atualiza logo, cores e suporte quando o servidor responder.
  const [marca, setMarca] = useState(() => {
    const m = guardar.ler(chaveMarca);
    if (!m?.slug) return null;
    aplicarMarca(m);
    return m;
  });
  const [falhaMarca, setFalhaMarca] = useState(null); // null | 'nao_encontrada' | 'instabilidade' (só sem marca guardada)
  const [falhaConteudo, setFalhaConteudo] = useState(false); // instabilidade sem conteúdo guardado
  const [sessao, setSessao] = useState(() => guardar.ler(chaveSessao));
  const [conteudo, setConteudo] = useState(() => sessao && normalizarConteudo(guardar.ler(`conteudo:${slug}`)));
  const [bloqueado, setBloqueado] = useState(null);
  const [oferta, setOferta] = useState(null); // pop-up de oferta (App 2.0)
  const [presente, setPresente] = useState(null); // funcionalidade do app com pop-up (ex.: presente de Natal)
  const [presenteModulo, setPresenteModulo] = useState(null); // 03/11/2026: presente que espera o aluno abrir um módulo
  const rota = useRota();
  const [prog, marcarVista] = useProgresso(`progresso:${slug}:${sessao?.aluno?.email || ''}`);

  const buscarMarca = () =>
    api('/marca?m=' + encodeURIComponent(slug), { tempo: 10000 })
      .then((m) => {
        m = { ...m, logo_url: daRaiz(m.logo_url) };
        aplicarMarca(m);
        setMarca(m);
        setFalhaMarca(null);
        guardar.salvar(chaveMarca, m);
      })
      .catch((e) => {
        if (guardar.ler(chaveMarca)?.slug) return; // segue com a guardada
        setFalhaMarca(e.codigo === 'marca_nao_encontrada' ? 'nao_encontrada' : 'instabilidade');
      });
  useEffect(() => { buscarMarca(); }, []);

  // Busca o conteúdo atualizado sempre que abre (mostra o salvo enquanto isso).
  // Sessões guest: carregam o snapshot local /app/conteudo.json (acesso com qualquer e-mail).
  // Só um 401 (o servidor respondeu que a sessão não vale) desloga; instabilidade nunca desloga.
  const buscarConteudo = (token) => {
    if (String(token || '').startsWith('guest:')) {
      return fetch('/app/conteudo.json', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('falha'); return r.json(); })
        .then((c) => {
          c = normalizarConteudo(c);
          if (sessao?.aluno) c.aluno = sessao.aluno;
          setConteudo(c);
          setFalhaConteudo(false);
          guardar.salvar(`conteudo:${slug}`, c);
        })
        .catch(() => setFalhaConteudo(true));
    }
    return api('/conteudo', { token, tempo: 10000 })
      .then((c) => { c = normalizarConteudo(c); setConteudo(c); setFalhaConteudo(false); guardar.salvar(`conteudo:${slug}`, c); })
      .catch((e) => { if (e.status === 401) sair(false); else setFalhaConteudo(true); });
  };
  useEffect(() => {
    if (!sessao) return;
    buscarConteudo(sessao.token);
    if (String(sessao.token || '').startsWith('guest:')) return;
    // aparelho e avisos (App 2.0): um pouco depois, para não disputar com o conteúdo
    const t = setTimeout(() => informarAparelho(sessao.token, entrouAgora ? { abertura: true } : { abertura: true, origem: ORIGEM_ABERTURA }), 1500);
    // pop-up de oferta e funcionalidades do app (presente de Natal…): uma consulta de cada por abertura. Só UM pop-up
    // aparece: funcionalidade com prioridade > 0 ("antes") ganha da oferta; com prioridade < 0 ("depois"), só se não houver oferta
    const t2 = setTimeout(() => {
      Promise.all([
        api('/oferta', { token: sessao.token }).then((r) => r?.oferta || null).catch(() => null),
        api('/funcionalidades', { token: sessao.token }).then((r) => (r?.itens || []).sort((a, b) => (b.prioridade || 0) - (a.prioridade || 0))).catch(() => []),
      ]).then(([of, itens]) => {
        // 03/11/2026: funcionalidade com momento "modulo" não disputa com a oferta: espera o aluno abrir um módulo
        const noModulo = itens.find((x) => x.momento === 'modulo');
        if (noModulo) setPresenteModulo(noModulo);
        const f = itens.filter((x) => x.momento !== 'modulo')[0];
        if (f && (f.prioridade > 0 || !of)) setPresente(f);
        else if (of) setOferta(of);
      });
    }, 2500);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [sessao?.token]);
  // presente "ao abrir um módulo": na tela do produto (os conteúdos), 1,2 s depois de abrir, se nenhum outro pop-up estiver aberto
  useEffect(() => {
    if (!presenteModulo || presente || oferta || bloqueado || !/^#?\/produto\//.test(rota)) return;
    const t = setTimeout(() => { setPresente(presenteModulo); setPresenteModulo(null); }, 1200);
    return () => clearTimeout(t);
  }, [rota, presenteModulo, presente, oferta, bloqueado]);

  function entrar(r) {
    entrouAgora = true;
    guardar.apagar('origem:pendente');
    guardar.salvar(chaveSessao, r);
    setSessao(r);
    location.hash = '#/';
  }

  function sair(avisarServidor = true) {
    const guest = String(sessao?.token || '').startsWith('guest:');
    if (avisarServidor && sessao && !guest) api('/logout', { metodo: 'POST', token: sessao.token }).catch(() => {});
    guardar.apagar(chaveSessao);
    guardar.apagar(`conteudo:${slug}`);
    setSessao(null);
    setConteudo(null);
  }

  if (!marca && falhaMarca === 'nao_encontrada') {
    return html`<div class="carregando-tela"><p class="vazio">Área de membros não encontrada para este endereço.</p></div>`;
  }
  if (!marca && falhaMarca) return html`<${Instabilidade} aoTentar=${buscarMarca} />`;
  if (!marca) return html`<div class="carregando-tela"><div class="spinner" aria-label="Carregando"></div></div>`;
  if (!sessao) return html`<${Login} marca=${marca} aoEntrar=${entrar} />`;
  if (!conteudo && falhaConteudo) return html`<${Instabilidade} marca=${marca} aoTentar=${() => buscarConteudo(sessao.token)} />`;
  if (!conteudo) return html`<div class="carregando-tela"><div class="spinner" aria-label="Carregando"></div></div>`;

  let tela;
  let interna = false; // produto ou aula: topo da marca não fica fixo
  const [, secao, id] = rota.split('/');
  const liberados = conteudo.produtos.filter((p) => p.liberado);
  if (secao === 'produto') {
    const produto = liberados.find((p) => p.id === id);
    tela = produto ? html`<${Produto} produto=${produto} prog=${prog} />` : null;
    interna = !!produto;
  } else if (secao === 'aula') {
    const produto = liberados.find((p) => p.aulas.some((a) => a.id === id));
    const aula = produto?.aulas.find((a) => a.id === id);
    tela = aula
      ? html`<${Aula} aula=${aula} produto=${produto} playerPanda=${conteudo.panda_player} marcarVista=${marcarVista} token=${sessao.token} aoDerrubar=${() => sair(false)} />`
      : null;
    interna = !!aula;
  }
  if (!tela) {
    interna = false;
    tela = html`<${Inicio} marca=${marca} conteudo=${conteudo} prog=${prog} aoClicarBloqueado=${setBloqueado} token=${sessao.token} />`;
  }

  return html`
    <div class=${tela && interna ? 'tela-interna' : ''}>
    <${Topo} marca=${marca} aoSair=${() => sair()} />
    <main>${tela}</main>
    <footer class="rodape"><${Suporte} marca=${marca} /></footer>
    </div>
    <${DialogoBloqueado} produto=${bloqueado} marca=${marca} aoFechar=${() => setBloqueado(null)} />
    ${oferta && !interna && !bloqueado && html`<${PopupOferta} oferta=${oferta} token=${sessao.token} aoFechar=${() => setOferta(null)} />`}
    ${presente && presente.tipo === 'roleta' && !interna && !bloqueado && html`<${PopupRoleta} item=${presente} token=${sessao.token} aoFechar=${() => setPresente(null)} />`}
    ${presente && presente.tipo !== 'roleta' && (!interna || presente.momento === 'modulo') && !bloqueado && html`<${PopupPresente} item=${presente} token=${sessao.token} aoFechar=${() => setPresente(null)}
      aoAceitar=${() => buscarConteudo(sessao.token)} />`}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
