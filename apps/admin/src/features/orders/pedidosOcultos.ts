/**
 * IDs de pedido "limpos" do Kanban pelo botao "Limpar pedidos em
 * aberto" — so um filtro de tela, guardado neste navegador. NAO muda
 * status, NAO estorna pagamento, NAO mexe em cupom nem em cashback: o
 * pedido continua existindo exatamente como estava, so para de
 * aparecer aqui. Pedido de teste acumulando no Kanban some da vista
 * sem arriscar cancelar (e estornar) um pedido real por engano.
 *
 * Fica em localStorage, e nao no servidor, de proposito: e uma
 * preferencia de "o que eu quero ver na minha tela agora", nao um dado
 * do negocio — nao faz sentido sincronizar entre aparelhos nem herdar
 * pedidos futuros de quem nunca clicou em limpar.
 */

const CHAVE = 'pedidos-ocultos-do-kanban';

function ler(): Set<string> {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? new Set(JSON.parse(bruto)) : new Set();
  } catch {
    return new Set();
  }
}

function salvar(ids: Set<string>): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify([...ids]));
  } catch {
    /* Storage cheio ou bloqueado (modo privado): a limpeza so nao
       persiste entre recarregamentos, mas nao quebra a tela por isso. */
  }
}

export function obterOcultos(): Set<string> {
  return ler();
}

/** Marca estes pedidos como ocultos — usado pelo botao de limpeza em massa. */
export function ocultarPedidos(ids: string[]): void {
  const atuais = ler();
  for (const id of ids) atuais.add(id);
  salvar(atuais);
}

/**
 * Remove da lista de ocultos quem nao esta mais na lista viva.
 *
 * Sem isto, `pedidos-ocultos-do-kanban` so cresceria: todo pedido
 * escondido ficaria salvo para sempre, mesmo depois de sair do
 * Kanban por conta propria (entregue, cancelado, ou simplesmente saiu
 * da janela dos ultimos 100 pedidos). Chamado a cada carregamento com
 * a lista atual de ids em andamento.
 */
export function podarOcultos(idsVivos: Set<string>): void {
  const atuais = ler();
  let mudou = false;
  for (const id of atuais) {
    if (!idsVivos.has(id)) {
      atuais.delete(id);
      mudou = true;
    }
  }
  if (mudou) salvar(atuais);
}
