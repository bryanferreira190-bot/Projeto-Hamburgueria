/* ==========================================================================
   ADVENTURE BURGUER — main.js
   ========================================================================== */

/* --------------------------------------------------------------------------
   1) LINK DO PEDIDO ONLINE
   Todo botão/link com a classe .js-pedido aponta para o endereço abaixo.
   Para trocar o destino no site inteiro, mude APENAS esta linha.
   -------------------------------------------------------------------------- */
const LINK_PEDIDO = 'https://www.whatsmenu.com.br/adventureburguer';

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
   Filtro de categorias do cardápio
   ========================================================================== */
function initTabs(){
  const tabs  = document.querySelectorAll('.tab');
  const cards = document.querySelectorAll('#menuGrid .card');

  const filtrar = (cat) => {
    let atraso = 0;
    cards.forEach(card => {
      const combina = card.dataset.cat === cat;
      card.classList.toggle('is-hidden', !combina);
      if (combina){
        // reinicia a animação de entrada, em cascata
        card.style.animation = 'none';
        void card.offsetWidth;
        card.style.animation = `cardIn .5s var(--ease) ${atraso}s both`;
        atraso += 0.04;
      }
    });
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      filtrar(tab.dataset.cat);
    });
  });

  filtrar('classicos'); // categoria inicial
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
  initTabs();
  initFab();
  initVideoSobre();
  initAno();
  atualizarStatus();
  setInterval(atualizarStatus, 60000); // revalida a cada minuto
});
