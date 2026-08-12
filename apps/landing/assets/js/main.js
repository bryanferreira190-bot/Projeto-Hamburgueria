/* ==========================================================================
   ADVENTURE BURGUER — main.js
   ========================================================================== */

/* --------------------------------------------------------------------------
   1) LINK DO PEDIDO ONLINE
   Todo botão/link com a classe .js-pedido aponta para o endereço abaixo.
   Para trocar o destino no site inteiro, mude APENAS esta linha.
   -------------------------------------------------------------------------- */
const LINK_PEDIDO = 'https://loja.impactdev.site';

/* --------------------------------------------------------------------------
   2) HORÁRIO DE FUNCIONAMENTO
   Formato: [dia da semana] = [ { abre: 'HH:MM', fecha: 'HH:MM' } ] ou null.
   0 = Domingo, 1 = Segunda ... 6 = Sábado.
   Para mudar um horário, edite só esta tabela (e o texto no index.html).
   -------------------------------------------------------------------------- */
const HORARIOS = {
  0: { abre: '18:00', fecha: '22:30' }, // Domingo
  1: null,                              // Segunda — fechado
  2: null,                              // Terça  — fechado
  3: null,                              // Quarta — fechado
  4: { abre: '18:00', fecha: '22:30' }, // Quinta
  5: { abre: '18:00', fecha: '22:30' }, // Sexta
  6: { abre: '17:00', fecha: '22:30' }  // Sábado
};

const NOMES_DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];


/* ==========================================================================
   Aplica o link de pedido em todos os elementos .js-pedido
   ========================================================================== */
function aplicarLinkPedido(){
  document.querySelectorAll('.js-pedido').forEach(el => {
    el.setAttribute('href', LINK_PEDIDO);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  });
}


/* ==========================================================================
   Navegação — sombra ao rolar + menu mobile
   ========================================================================== */
function initNav(){
  const nav    = document.getElementById('nav');
  const burger = document.getElementById('navBurger');
  const links  = document.getElementById('navLinks');

  // O menu mobile abre logo abaixo da barra. Como a faixa vermelha some ao
  // rolar, a barra muda de posição — então guardamos onde ela termina em
  // --nav-bottom, que o CSS usa para posicionar o painel.
  const medirBarra = () => {
    document.documentElement.style.setProperty(
      '--nav-bottom', Math.round(nav.getBoundingClientRect().bottom) + 'px'
    );
  };

  const onScroll = () => {
    nav.classList.toggle('is-stuck', window.scrollY > 20);
    medirBarra();
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', medirBarra);

  const fechar = () => {
    links.classList.remove('is-open');
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  burger.addEventListener('click', () => {
    const abrindo = !links.classList.contains('is-open');
    medirBarra(); // garante a medida certa no momento em que abre
    links.classList.toggle('is-open', abrindo);
    burger.classList.toggle('is-open', abrindo);
    burger.setAttribute('aria-expanded', String(abrindo));
    document.body.style.overflow = abrindo ? 'hidden' : '';
  });

  links.querySelectorAll('a').forEach(a => a.addEventListener('click', fechar));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
}


/* ==========================================================================
   Scroll reveal — animação suave de entrada
   ========================================================================== */
function initReveal(){
  const alvos = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)){
    alvos.forEach(el => el.classList.add('is-in'));
    return;
  }
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting){
        entrada.target.classList.add('is-in');
        obs.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  alvos.forEach(el => obs.observe(el));
}


/* ==========================================================================
   Vitrine dos favoritos — troca a foto sozinha, com setas e bolinhas

   Não há lista de produtos aqui de propósito: nome e descrição saem dos
   data-nome/data-desc do próprio HTML, e as bolinhas são ligadas pela
   ordem. Assim, acrescentar um terceiro lanche é só mexer no HTML.
   ========================================================================== */
const FAVORITO_INTERVALO = 6000;

function initFavoritos(){
  const area = document.getElementById('favoritos');
  if (!area) return;

  const fotos = [...area.querySelectorAll('.favorito')];
  const dots  = [...area.querySelectorAll('.favoritos__dot')];
  const info  = area.querySelector('.favoritos__info');
  const nome  = area.querySelector('.favoritos__nome');
  const desc  = area.querySelector('.favoritos__desc');
  const barra = area.querySelector('.favoritos__barra span');
  if (fotos.length < 2) return;

  // Quem pediu menos movimento no sistema não recebe troca automática.
  const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let atual = 0;
  let relogio = null;
  let trocando = false;

  area.style.setProperty('--intervalo', FAVORITO_INTERVALO + 'ms');

  function reiniciarBarra(){
    if (!barra || menosMovimento) return;
    barra.classList.remove('is-correndo');
    // Forçar o reflow reinicia a animação; sem isto ela continuaria de onde parou.
    void barra.offsetWidth;
    barra.classList.add('is-correndo');
  }

  function mostrar(indice){
    indice = (indice + fotos.length) % fotos.length;
    if (indice === atual || trocando) return;
    trocando = true;

    const saindo = fotos[atual];
    const entrando = fotos[indice];

    saindo.classList.remove('is-ativo');
    saindo.classList.add('is-saindo');
    entrando.classList.add('is-ativo');

    // A classe de saída é limpa depois da transição, senão a foto
    // reapareceria encolhida na próxima volta do ciclo.
    setTimeout(() => {
      saindo.classList.remove('is-saindo');
      trocando = false;
    }, 900);

    // O texto sai, é trocado fora da vista e volta — dá a impressão de
    // que ele acompanha a foto, sem precisar duplicar o markup.
    info?.classList.add('is-trocando');
    setTimeout(() => {
      if (nome) nome.textContent = entrando.dataset.nome || '';
      if (desc) desc.textContent = entrando.dataset.desc || '';
      info?.classList.remove('is-trocando');
    }, 350);

    dots[atual]?.classList.remove('is-ativo');
    dots[indice]?.classList.add('is-ativo');

    atual = indice;
    reiniciarBarra();
  }

  function agendar(){
    if (menosMovimento) return;
    clearInterval(relogio);
    relogio = setInterval(() => mostrar(atual + 1), FAVORITO_INTERVALO);
    reiniciarBarra();
  }

  function irPara(indice){
    mostrar(indice);
    agendar();   // qualquer clique reinicia a contagem
  }

  area.querySelector('.favoritos__seta--prev')
      ?.addEventListener('click', () => irPara(atual - 1));
  area.querySelector('.favoritos__seta--next')
      ?.addEventListener('click', () => irPara(atual + 1));

  dots.forEach((dot, i) => dot.addEventListener('click', () => irPara(i)));

  // Com o mouse em cima, ninguém quer a foto trocando no meio da leitura.
  area.addEventListener('mouseenter', () => { clearInterval(relogio); barra?.classList.remove('is-correndo'); });
  area.addEventListener('mouseleave', agendar);

  // Aba em segundo plano não precisa gastar troca de foto.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(relogio);
    else agendar();
  });

  agendar();
}


/* ==========================================================================
   Status Aberto / Fechado em tempo real
   ========================================================================== */
function minutosDoDia(hhmm){
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function proximaAbertura(diaAtual){
  for (let i = 1; i <= 7; i++){
    const dia = (diaAtual + i) % 7;
    if (HORARIOS[dia]){
      const quando = i === 1 ? 'amanhã' : NOMES_DIAS[dia];
      return `Abrimos ${quando} às ${HORARIOS[dia].abre}`;
    }
  }
  return 'Consulte nossos horários';
}

function atualizarStatus(){
  const agora   = new Date();
  const dia     = agora.getDay();
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  const hoje    = HORARIOS[dia];

  let aberto = false;
  let detalhe = '';

  if (hoje){
    const abre  = minutosDoDia(hoje.abre);
    const fecha = minutosDoDia(hoje.fecha);
    if (minutos >= abre && minutos < fecha){
      aberto  = true;
      detalhe = `Atendemos até as ${hoje.fecha}`;
    } else if (minutos < abre){
      detalhe = `Abrimos hoje às ${hoje.abre}`;
    } else {
      detalhe = proximaAbertura(dia);
    }
  } else {
    detalhe = proximaAbertura(dia);
  }

  const estado = aberto ? 'aberto' : 'fechado';

  // Pílula no topo
  const pill = document.getElementById('statusPill');
  if (pill){
    pill.dataset.status = estado;
    document.getElementById('statusText').textContent = aberto ? 'Aberto agora' : 'Fechado no momento';
  }

  // Card na seção de horários
  const card = document.getElementById('statusCard');
  if (card){
    card.dataset.status = estado;
    document.getElementById('statusTitle').textContent  = aberto ? 'Estamos abertos' : 'Estamos fechados';
    document.getElementById('statusDetail').textContent = detalhe;
  }

  // Destaca o dia de hoje na lista
  document.querySelectorAll('#hoursList li').forEach(li => {
    li.classList.toggle('is-today', Number(li.dataset.day) === dia);
  });
}


/* ==========================================================================
   Botão flutuante — aparece depois do hero
   ========================================================================== */
function initFab(){
  const fab  = document.querySelector('.fab');
  const hero = document.getElementById('hero');
  if (!fab || !hero) return;

  const onScroll = () => {
    fab.classList.toggle('is-visible', window.scrollY > hero.offsetHeight * 0.6);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}


/* ==========================================================================
   Vídeo do estabelecimento — botão de som e economia de dados
   ========================================================================== */
function initVideoSobre(){
  const video = document.getElementById('videoSobre');
  const botao = document.getElementById('btnSomVideo');
  if (!video || !botao) return;

  const ico = botao.querySelector('.about__som-ico');

  botao.addEventListener('click', () => {
    video.muted = !video.muted;
    ico.textContent = video.muted ? '🔇' : '🔊';
    botao.setAttribute('aria-pressed', String(!video.muted));
    botao.setAttribute('aria-label', video.muted ? 'Ativar som do vídeo' : 'Desativar som do vídeo');
    if (!video.muted) video.play().catch(() => {});
  });

  // Só roda enquanto estiver visível na tela — poupa bateria e dados de quem
  // está no celular e já passou da seção.
  if ('IntersectionObserver' in window){
    const obs = new IntersectionObserver(entradas => {
      entradas.forEach(e => {
        if (e.isIntersecting) video.play().catch(() => {});
        else video.pause();
      });
    }, { threshold: 0.25 });
    obs.observe(video);
  }
}


/* ==========================================================================
   Ano do rodapé
   ========================================================================== */
function initAno(){
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}


/* ==========================================================================
   Inicialização
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  aplicarLinkPedido();
  initNav();
  initReveal();
  initFavoritos();
  initFab();
  initVideoSobre();
  initAno();
  atualizarStatus();
  setInterval(atualizarStatus, 60000); // revalida a cada minuto
});
