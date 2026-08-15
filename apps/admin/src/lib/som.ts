/**
 * Aviso sonoro de pedido novo.
 *
 * O som e SINTETIZADO na hora, com a Web Audio API, em vez de vir de um
 * arquivo de audio: o toque do iPhone e da Apple e nao pode ser
 * redistribuido dentro do sistema. O que existe aqui e um trio de notas
 * de sino com a mesma ideia — curto, agudo e destacado o bastante para
 * ser ouvido no barulho da cozinha. Sintetizar tambem evita mais um
 * arquivo binario no repositorio e mais uma requisicao no carregamento.
 */

/** Notas do aviso: frequencia em Hz e atraso, em segundos, desde o inicio. */
const NOTAS = [
  { hz: 1318.51, atraso: 0 }, // Mi6
  { hz: 987.77, atraso: 0.13 }, // Si5
  { hz: 1567.98, atraso: 0.26 }, // Sol6
] as const;

/** Tempo ate a nota sumir. Sino: cai sozinho, nao e cortado. */
const DURACAO = 0.55;
const VOLUME = 0.22;

let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (contexto) return contexto;

  const Construtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Construtor) return null;

  contexto = new Construtor();
  return contexto;
}

/**
 * O navegador so libera audio depois de alguma interacao da pessoa com a
 * pagina. Como o aviso toca sozinho (o pedido chega pelo refetch, sem
 * ninguem clicar), o contexto precisa ter sido destravado ANTES, num
 * clique qualquer — e o que o botao de ligar o som faz, e tambem o
 * primeiro clique em qualquer lugar do painel.
 */
export async function destravarSom(): Promise<boolean> {
  const audio = obterContexto();
  if (!audio) return false;

  if (audio.state === 'suspended') {
    try {
      await audio.resume();
    } catch {
      /* Sem interacao valida ainda; tenta de novo no proximo clique. */
      return false;
    }
  }

  return audio.state === 'running';
}

export async function tocarAvisoDePedido(): Promise<void> {
  const audio = obterContexto();
  if (!audio) return;
  if (audio.state !== 'running' && !(await destravarSom())) return;

  for (const nota of NOTAS) {
    tocarNota(audio, nota.hz, audio.currentTime + nota.atraso);
  }
}

/**
 * Uma nota com timbre de sino: ataque quase instantaneo e decaimento
 * exponencial. A segunda oscilacao, uma oitava acima e bem mais baixa, e
 * o que tira o som do "bipe de forno" e aproxima de um sino de verdade.
 */
function tocarNota(audio: AudioContext, hz: number, inicio: number): void {
  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(0, inicio);
  envelope.gain.linearRampToValueAtTime(VOLUME, inicio + 0.01);
  /* exponentialRamp nunca chega a zero de verdade — 0.0001 e o silencio
     na pratica, e a curva exponencial e o que soa natural aqui. */
  envelope.gain.exponentialRampToValueAtTime(0.0001, inicio + DURACAO);
  envelope.connect(audio.destination);

  const HARMONICOS = [
    { multiplo: 1, proporcao: 1 },
    { multiplo: 2, proporcao: 0.35 },
  ];

  for (const harmonico of HARMONICOS) {
    const oscilador = audio.createOscillator();
    oscilador.type = 'sine';
    oscilador.frequency.value = hz * harmonico.multiplo;

    const mistura = audio.createGain();
    mistura.gain.value = harmonico.proporcao;

    oscilador.connect(mistura).connect(envelope);
    oscilador.start(inicio);
    oscilador.stop(inicio + DURACAO);
  }
}
