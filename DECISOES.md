# Registro de decisões técnicas

Decisões que não são óbvias pelo código, com o motivo por trás.
Formato: mais recente no topo.

---

## 2026-08-21 — WhatsApp: pedido "Pronto" (READY) ganha notificação própria

Reportado pelo dono: pedido recebido, em preparo, saiu para entrega e
entregue mandavam mensagem automática — só "Pronto" não mandava nada.
Não era bug de execução: a decisão original (ver entrada de
2026-08-20 sobre a integração Evolution) deliberadamente não mapeava
`READY`/`AWAITING_PICKUP` a nenhum evento, com o raciocínio "quem
retira no balcão não precisa de WhatsApp para isso". Na prática esse
raciocínio só valia para quem RETIRA — para entrega, o cliente também
esperava saber que o pedido tinha ficado pronto, e ninguém tinha
percebido a lacuna até testar o fluxo fim a fim.

Corrigido adicionando um evento `READY` (mesmo nome do status,
seguindo o padrão já usado por `PREPARING`/`OUT_FOR_DELIVERY`) —
migration aditiva de uma linha (`ALTER TYPE ... ADD VALUE`), igual às
duas anteriores. `AWAITING_PICKUP` continua sem evento próprio: agora
que `READY` avisa "pronto" para os dois tipos de pedido, um evento a
mais só para "retirada ainda esperando" repetiria a mesma informação.

Esse trecho de `OrdersService.updateStatus` (o mapeamento status →
evento de notificação) não tinha nenhum teste direto até aqui —
aproveitado para cobrir as transições PREPARING/READY/OUT_FOR_DELIVERY,
os dois casos que caem em DELIVERED (entrega e retirada), e o caso
AWAITING_PICKUP sem notificação, para uma lacuna assim não repetir sem
ninguém perceber de novo.

---

## 2026-08-20 — Lembrete diário de cashback: cron, não fila, reaproveitando NotificationLog

Novo evento `CASHBACK_REMINDER`: uma vez por dia, às 11h no fuso da
loja, avisa quem fez pedido **ontem** (qualquer status exceto
`CANCELED`) do saldo de cashback disponível — pedido explícito do
dono, para lembrar o cliente de voltar.

**Cron (`@nestjs/schedule`), não Redis/BullMQ.** O projeto não tem fila
hoje (ver decisão de 2026-08-19 sobre notificações de pedido) e o
mesmo padrão já resolve dois jobs existentes
(`CashbackExpiryJob`/`ExpiredPixJob`): uma consulta periódica no banco,
nunca um `setTimeout`. Isso é o que garante sobreviver a
restart/redeploy — a cada execução o job pergunta ao banco "quem se
encaixa na janela de ontem, ainda sem confirmação de envio", nunca
depende de um timer que morreria junto com o processo.

**Idempotência reaproveitando `NotificationLog` — nenhuma coluna nova,
nenhuma migration de tabela.** O pedido original sugeria uma coluna
tipo `cashbackReminderSentAt`; investigando primeiro, `NotificationLog`
(criado na feature de notificações via Evolution, 2026-08-20 mais
abaixo) já é exatamente essa estrutura — histórico de envio por
`(orderId, event, success)`, usado pelos outros 5 eventos. Bastou
adicionar `CASHBACK_REMINDER` ao enum `NotificationEvent` (migration
aditiva de uma linha, `ALTER TYPE ... ADD VALUE`) e chamar o mesmo
`MessagingService.notificar()` que os outros eventos já chamam — job
só decide QUEM é elegível, toda a idempotência/log/retry/template
continua sendo a mesma peça de sempre.

**Saldo zero: nunca manda mensagem, e nunca grava log de skip.** Pedido
explícito do dono. Como a consulta já filtra por
`createdAt` dentro de `[ontem, hoje)`, um pedido só é elegível NO DIA
seguinte ao dele — no dia seguinte a esse, a janela de datas já não o
inclui mais, então "não gravar nada" não vira "tentar de novo para
sempre": o pedido simplesmente sai de escopo sozinho, sem precisar de
nenhum estado extra para isso.

**Saldo consultado no momento do envio, nunca no momento do pedido.**
Reaproveita `CashbackService.saldoDoCliente(customerId)` — mesma
consulta de sempre, sem duplicar nenhuma regra de cashback.

---

## 2026-08-20 — 2FA do admin desativado temporariamente em produção, a pedido do dono

`REQUIRE_ADMIN_2FA` deixou de ser forçado para `true` em produção
(`apps/api/src/config/env.ts`). Até aqui, essa flag só existia para não
atrapalhar o desenvolvimento local — em produção o código sobrescrevia
qualquer valor do `.env`, de propósito, exatamente para que desativar o
2FA da conta OWNER (que controla faturamento e cadastro) nunca fosse
possível só trocando uma variável de ambiente.

O dono do projeto pediu explicitamente para desativar a cobrança do
código de autenticação no login, "temporariamente até eu pedir para
ativar novamente". Antes de mexer, o motivo foi confirmado com ele: não
era perda de acesso ao autenticador nem conveniência de desenvolvimento
— era mesmo desativar em produção, para todos os admins, sabendo que
isso remove essa proteção da conta OWNER até ele pedir de volta.

**Desenho pensado para ser revertido sem depender de mim de novo:**
`REQUIRE_ADMIN_2FA` agora controla de verdade as duas etapas onde o 2FA
entra — tanto obrigar quem ainda não tem a configurar (`AdminAuthService.login`,
já existia) quanto cobrar o código de quem já tem 2FA ativo
(`AdminAuthService.login`, verificação nova). Com a flag em `false`
(hoje, em produção), nenhuma das duas roda. **Reativar é só voltar
`REQUIRE_ADMIN_2FA=true` no Railway e reiniciar o serviço** — nenhum
admin perde o cadastro de 2FA (`totpSecret`/`totpEnabledAt` continuam no
banco), a cobrança simplesmente volta a valer no próximo login de cada
um.

---

## 2026-08-20 — Notificações de pedido: Evolution API (Baileys) ativa agora, Meta pronta para depois

O projeto já tinha uma integração dormente com a Meta Cloud API oficial
(`apps/api/src/modules/whatsapp/`, `WHATSAPP_ENABLED=false`), e
`ARQUITETURA.md` documentava explicitamente a decisão de não usar
bibliotecas não-oficiais (Baileys/Venom) por risco de banimento do número
comercial (ver a entrada de 2026-08-02 mais abaixo). O dono pediu uma
integração usando **Evolution API** — que roda sobre Baileys — para uma
instância já conectada e testada manualmente no Render.

Isso é um conflito direto com a decisão documentada, então foi levantado
explicitamente antes de qualquer código, com três caminhos possíveis:
ativar só a Meta (mais lento, sem risco), ativar só a Evolution (mais
rápido, risco aceito), ou os dois coexistindo. **Escolha do dono: os
dois** — Evolution ativa agora (`WHATSAPP_PROVIDER=evolution`), Meta
mantida pronta e intocada para quando a verificação do WhatsApp Business
Manager terminar (troca vira só mudar variável de ambiente).

**Módulo novo (`apps/api/src/modules/notifications/`), não reaproveita o
`whatsapp/` existente.** Os dois HTTP clients (`EvolutionWhatsAppProvider`
e `meta-graph.client.ts`) não compartilham código de propósito: são
provedores genuinamente independentes, com autenticação, formato de corpo
e taxonomia de erro próprios — forçar as duas implementações a
compartilhar base técnica criaria acoplamento entre coisas que precisam
poder mudar (ou sumir) sem se afetar uma à outra. A pequena duplicação do
laço de retry (~30 linhas, mesmo padrão) é o preço aceito. Já as funções
puras de telefone (`paraFormatoInternacional`, `mascararTelefone`) foram
reaproveitadas de `whatsapp/whatsapp.utils.ts` — não têm estado nem nada
específico de um provedor.

**Disparo é fire-and-forget (`void promise.catch(...)`), nunca
`await`ado** por quem cria/atualiza pedido em `OrdersService`/
`PaymentsService` — diferente do padrão usado para cashback (que é
aguardado dentro de try/catch). A instância Evolution roda no plano
gratuito do Render, que hiberna; um `await` aqui poderia pendurar a
resposta HTTP de quem mudou o status do pedido esperando a Evolution
acordar. Pedido é prioridade; WhatsApp é secundário — nunca pode
bloquear ou falhar o fluxo do pedido.

**Idempotência por consulta antes de mandar, não por constraint única.**
Antes de enviar, confere se já existe `NotificationLog` de sucesso para
`(orderId, event)`; se sim, pula. Não usa `@@unique` na tabela de log
porque uma falha seguida de sucesso é um histórico legítimo (duas linhas
para o mesmo evento), e é defesa a mais — as transições de status que
disparam notificação já são protegidas por compare-and-swap em
`OrdersService.updateStatus()`/`PaymentsService.avancarPedidoConformePagamento()`.

**Sem fila (Redis/BullMQ) — decisão explícita, não omissão.** O projeto
não usa fila hoje; adicionar uma só para isto seria infraestrutura nova
para um caso de uso que já tem defesa suficiente (retry em memória, até 3
tentativas com backoff exponencial + jitter). Se as 3 tentativas
esgotarem, aquela notificação específica se perde — aceitável por ser
notificação, não o pedido em si.

Templates de mensagem ficam no banco (`NotificationTemplate`, por loja e
evento), editáveis pelo admin sem deploy, com placeholders de texto livre
(`{nome} {pedido} {valor} {status} {telefone}`) substituídos por
`split/join` em vez de regex — `{`/`}` são caracteres especiais de regex,
e o texto é editado por humano.

Ver `apps/api/src/modules/notifications/README.md` para detalhes de
configuração, mapeamento evento→status e instruções de teste.

---

## 2026-08-19 — Filtro de data no Histórico recente

Antes, o Histórico era so um recorte (client-side) da mesma lista dos
últimos 100 pedidos que o Kanban usa para o trabalho em andamento. Um
filtro de data sobre essa lista seria enganoso: pedido antigo que já
saiu da janela dos 100 nunca apareceria, mesmo estando exatamente no
período pedido — e em dia de movimento, nem precisa ser tão antigo
assim para sair da janela.

`Historico` passou a ter consulta própria (`useQuery` com chave
`['orders', 'historico', de, ate]`), com o filtro de status
(`DELIVERED`/`COMPLETED`/`CANCELED`) e o período indo direto no
servidor — a API já suportava `status`/`from`/`to` em `GET /orders`
desde a listagem original, só faltava expor `from`/`to` no cliente e
uma UI para isso. **Nenhuma mudança de backend foi necessária.**

`inicioDoDia`/`fimDoDia` convertem a data do `<input type="date">`
(`AAAA-MM-DD`, sem fuso) para o início/fim daquele dia no fuso do
navegador, antes de mandar em ISO — verificado contra produção: os
limites calculados (`...T03:00:00.000Z` a `...T02:59:59.999Z` para um
dia em UTC-3) bateram exatamente com os pedidos esperados daquele dia,
nem um a mais nem a menos.

Como o filtro ainda usa `limit: 100` (teto da API), um período muito
largo pode ter mais pedido resolvido do que isso — a tela avisa
("mostrando os 100 mais recentes deste período") em vez de esconder o
resto em silêncio, usando o mesmo `nextCursor` que a paginação por
cursor da API já devolve.

---

## 2026-08-19 — Balcão: observação por item em Porções e Bebidas

Pedido do dono: bebida e porção não têm grupo de adicionais (nenhum
produto dessas duas categorias tem — conferido no banco), então tocar
no item lançava direto na comanda, sem chance de anotar "sem gelo",
"gelada" ou "sem sal". A única observação disponível era a do pedido
inteiro, misturando tudo.

`aoClicarProduto` agora decide em três caminhos: produto com adicional
sempre abre `EscolherAdicionais` (que já tinha campo de observação);
produto de `porcoes`/`bebidas` sem adicional abre um confirm leve novo
(`ConfirmarComObservacao`) com um campo de texto — Enter confirma,
igual ao resto do balcão, onde cada toque a menos conta; qualquer outro
produto sem adicional continua lançando direto, sem tela no meio.

Nenhuma mudança de backend: o campo `notes` por item já existia no
schema (usado até agora só pelo caminho de adicionais) — só faltava
outro caminho na tela chegando até ele.

---

## 2026-08-19 — "Limpar pedidos em aberto" virou limpeza SÓ VISUAL

Correção direta do dono sobre a decisão de ontem: o botão não deveria
cancelar pedido de verdade (nem estornar pagamento) — só tirar da
frente os pedidos que estão poluindo o Kanban. Reduz o escopo da
decisão anterior neste mesmo arquivo.

Removido por completo o caminho antigo: rota `POST /orders/cancel-open`,
`OrdersService.cancelarTodosAbertos()`, o schema e os testes — não faz
sentido deixar parado um endpoint que cancela e estorna pedido em
massa se ninguém vai chamar ele.

No lugar, `pedidosOcultos.ts` guarda um `Set` de ids num `localStorage`
deste navegador (chave `pedidos-ocultos-do-kanban`). `usePedidosGlobais`
filtra esses ids da lista ENQUANTO o pedido continuar não-terminal — se
algum dia ele for concluído/cancelado por outro caminho, volta a
aparecer normalmente no Histórico, porque nada foi de fato apagado ou
alterado no banco. Uma poda automática (`podarOcultos`) tira da lista
quem já não está mais em aberto, para o `localStorage` não crescer para
sempre.

Mantido por pedido explícito: a confirmação antes de executar (mesmo
sendo só visual, "sumir com tudo de um clique" merece um segundo
passo) e o mesmo visual do botão/modal — só o texto mudou, para não
mencionar mais cancelamento nem estorno, que deixaram de acontecer.

---

## 2026-08-19 — Botão "Limpar pedidos em aberto" no painel

Pedido direto do dono, para não precisar mais me pedir para rodar
script toda vez que sobrar pedido de teste travado no Kanban (como
aconteceu nos dois dias anteriores). Duas decisões confirmadas com ele
antes de implementar: cancela TODOS os pedidos em aberto de uma vez,
sem filtro por idade; e liberado para qualquer papel KITCHEN+, não só
o dono.

Como é destrutivo de verdade (cancela pedido de verdade, com estorno
se já tiver sido pago), o botão só ABRE um modal de confirmação — o
cancelamento em si só roda depois de um segundo clique lá dentro, que
mostra quantos pedidos serão afetados e avisa que pagamento recebido é
estornado automaticamente.

`OrdersService.cancelarTodosAbertos()` reaproveita `updateStatus()`
pedido por pedido, em vez de um `updateMany` direto no banco — precisa
do mesmo tratamento de sempre por pedido (estorno, devolução de cupom,
anulação de cashback já creditado via `anularCreditoDoPedido`). Um
pedido que falhar (corrida com o cliente pagando bem nessa hora, por
exemplo) não impede os demais; o resultado devolve quantos foram e
quantos não foram, e o admin vê os dois números.

Testado ao vivo em produção: 9 pedidos de teste do cliente "Comanda"
(sobra da testagem do balcão) cancelados de uma vez, 0 falhas, 0
pedidos em aberto restantes — nenhum pedido de outro dia (número
repete diariamente) foi tocado.

---

## 2026-08-18 — Balcão avisa antes de renomear cliente com telefone repetido

Bug real relatado e reproduzido com dado de producao: um pedido de
balcão lançado com nome "Comanda" e telefone `11970706978` sobrescreveu
silenciosamente o nome de um cliente já cadastrado com esse mesmo
telefone (era "TESTE"). Não é bug de código — é o comportamento
INTENCIONAL de `customer.upsert` (mesmo telefone = mesmo cliente,
update do nome) funcionando exatamente como projetado, só que sem
avisar quem está atendendo. No balcão, digitar o número errado por
pressa ou reaproveitar um número por hábito é fácil, e o preço de
errar é misturar o histórico (e o cashback!) de duas pessoas diferentes
sem ninguém perceber.

Criada `GET /orders/customer-lookup?phone=` (KITCHEN+, mesmo papel de
`createManual`) devolvendo o nome já associado a um telefone, ou `null`
se não há cadastro. `BalcaoPage` consulta isso com debounce de 300ms
assim que o telefone chega a 11 dígitos e:
- nome igual ou campo de nome vazio → só confirma discretamente que é
  cliente conhecido;
- nome DIFERENTE do cadastrado → alerta amarelo explicando o que vai
  acontecer, e **trava o botão "Lançar pedido"** até marcar um checkbox
  "É a mesma pessoa, pode renomear". Trocar telefone ou nome de novo
  reabre a confirmação — não fica valendo para um número diferente
  digitado em seguida. A checagem também é repetida no `enviar()`
  (defesa a mais, caso o estado do botão saia de sincronia).

Verificado com dado real de produção: telefone existente devolve o
nome atual (`{"name":"Comanda"}`), telefone novo devolve `null`,
telefone mal formatado devolve 422 — mesmo padrão das outras rotas
validadas por Zod.

---

## 2026-08-18 — Barra superior do painel quebrava no celular

Consequência dos últimos ajustes: mover o botão de som e o contador de
"em andamento" para a barra superior (para funcionarem em qualquer
aba, não só em Pedidos) engordou uma barra que já estava no limite —
logo + 4 abas (Pedidos, Balcão, Cashback, Dashboard) + som + nome do
admin + Sair, tudo numa linha sem `flex-wrap` nem rolagem. Em tela de
celular (~375–428px) isso passa fácil de 600px de largura somada,
estourando a tela.

Corrigido sem esconder nada: logo e o bloco da direita (som/admin/sair)
ficam com `shrink-0` — largura fixa, sempre visíveis por inteiro — e
só o `<nav>` do meio vira uma faixa com `overflow-x-auto` (rolagem
horizontal própria, sem afetar o resto da barra). O `min-w-0` no nav é
o que faz isso funcionar: sem ele, um item flex nunca encolhe além do
tamanho do próprio conteúdo, e a barra inteira voltaria a estourar em
vez de deixar só as abas rolarem. Cada aba ganhou `shrink-0
whitespace-nowrap` para não ter o texto espremido ao rolar.

`main`/`footer`/`header` também ganharam `px-4` no celular (`sm:px-6`
a partir daí), dando um respiro a mais nas telas mais estreitas.

---

## 2026-08-18 — Setas de rolagem do Kanban logo abaixo do título

A rolagem horizontal das colunas (commit anterior) funcionava só pela
barra nativa do navegador — que fica na base do container, depois de
toda a altura dos cartões. Numa tela que a cozinha deixa aberta o dia
inteiro, isso é longe demais da mão de quem está olhando o topo.

Adicionadas duas setas (‹ ›) logo abaixo do título "Pedidos", que
chamam `scrollBy({ left, behavior: 'smooth' })` no mesmo container via
`ref` — controlam exatamente a mesma rolagem, só que acessível sem
precisar descer a tela. A barra nativa continua funcionando (scroll do
mouse/trackpad), as setas são um atalho a mais, não substituem.

---

## 2026-08-18 — Kanban de pedidos: colunas de largura fixa com rolagem, não grid espremido

O ajuste anterior (6 colunas lado a lado com `xl:grid-cols-6`) deixou
cada coluna com ~190px — apertado demais para o cartão de pedido
(itens, endereço, botões de ação). Trocado o `grid` por um `flex` com
`overflow-x-auto`: cada coluna tem largura FIXA (`w-72`, 288px,
perto do que cada uma tinha no layout original de 4 colunas) e a
fileira toda rola na horizontal quando não cabe tudo de uma vez —
o mesmo padrão que Trello, Linear e Jira usam para isto. `snap-x` +
`snap-start` fazem a rolagem "encaixar" nas colunas em vez de parar
no meio de uma.

Container geral do painel (header, main, footer) alargado de
`max-w-7xl` (1280px) para `max-w-[1600px]`, dando mais respiro em
todas as páginas, não só no Kanban — em monitor largo a maioria das 6
colunas cabe sem precisar rolar; em tela menor, rola. Nunca mais
espremido, independente do tamanho da tela.

---

## 2026-08-18 — Aviso de pedido novo preso à aba, e consulta de pedidos mais leve

Dois problemas relatados: painel de pedidos demorando para carregar, e
pedido novo só "aparecendo" enquanto o dono estava na aba Pedidos.

**Causa raiz do segundo problema**: o polling de 15s (`useQuery` com
`refetchInterval`) e o hook do aviso sonoro (`useAvisoDePedidoNovo`)
viviam DENTRO do componente `OrdersPage`. Saindo para Balcão ou
Cashback, o componente desmontava, o polling parava e o aviso sonoro
parava de tocar — e ao voltar para Pedidos, sem cache quente, a tela
mostrava o carregamento do zero de novo. Isso também explica boa parte
do primeiro problema: não era só a consulta em si, era reconstruir tudo
do zero toda vez que se voltava para a aba.

Corrigido subindo o polling para o `Layout` (`usePedidosGlobais`, novo
hook em `features/orders/`), que fica montado o tempo todo enquanto
logado, independente da rota. `OrdersPage` passou a ler os MESMOS dados
(mesma chave de query `['orders']`, deduplicada pelo React Query) em
vez de fazer sua própria busca — trocar de aba e voltar agora é
instantâneo, e o aviso sonoro/indicador visual funcionam em qualquer
tela. O toggle de som e o contador de "pedidos em andamento" saíram da
página e foram para a barra de navegação (visível em qualquer aba),
já que o aviso também passou a valer em qualquer aba.

Busca continua sendo uma consulta À PARTE (`enabled` só quando há
termo digitado) — é um recorte diferente, filtrado no servidor, que não
faz sentido compartilhar com o polling global.

**Gate por papel**: `DELIVERY` é um papel válido no sistema mas não tem
acesso à rota de pedidos (`@RequireRole(KITCHEN)` na API — DELIVERY é
o único papel abaixo de KITCHEN na hierarquia). Como o Layout agora
busca isto em QUALQUER página, sem guarda um admin desse papel teria
uma chamada falhando de 15 em 15s em toda tela, não só em Pedidos.
`usePedidosGlobais` só ativa a consulta com `hasRoleLevel(role,
KITCHEN)`.

**Consulta mais leve**: `OrdersService.list()` — a rota mais chamada do
sistema (repetida a cada 15s, o dia inteiro) — buscava `statusHistory`
completo e `payments` de cada pedido, sem que o painel administrativo
lesse nenhum dos dois campos (`OrderRow`, o tipo usado pelo painel, nem
declara `timeline` ou `payment`). Só a tela de acompanhamento do
cliente usa esses campos, e ela passa por `findById`/`findByNumber`,
não por `list()`. Removidos do `include` da consulta de listagem;
`toOrderDto` recebe `statusHistory: []` e `payments: []` sintéticos
nesse caminho, produzindo `timeline: []` e `payment: null` — exatamente
o que o painel já ignorava antes. Medido contra produção: 39 pedidos,
73ms, 35KB — sem o histórico completo de status de cada pedido
carregado e serializado à toa a cada pedido, a cada 15 segundos.

---

## 2026-08-18 — Kanban de pedidos: 6 colunas lado a lado, expandir/recolher, histórico paginado

Pedido direto do dono: as 6 colunas (as 4 originais + Saiu para
entrega/Aguardando retirada) deveriam ficar lado a lado, não em duas
fileiras. Grid mudou de `xl:grid-cols-4` para
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` — em telas
largas as 6 cabem numa fileira só, usando toda a largura disponível
dentro do container já existente (`max-w-7xl px-5` em `App.tsx`, que já
garante a margem lateral sem precisar de nada novo aqui).

Contrapartida aceita: com 6 colunas dividindo a largura, cada uma fica
bem mais estreita que antes (~193px em vez de ~298px numa tela de
1280px). Foi uma escolha explícita do dono, ciente disso.

**Coluna que não acaba mais**: cada coluna mostra só os 5 primeiros
pedidos (`CARTOES_POR_COLUNA`), com um botão "Mostrar mais N" para
revelar o resto — e "Mostrar menos" para recolher de volta. Estado por
coluna (`Set<OrderStatus>`), não por pedido: expandir "Em preparo" não
mexe nas outras. Sobrevive ao refetch de 15s porque a chave é o status
da coluna, não a lista de pedidos em si.

**Histórico paginado**: 15 linhas por página, com botões numerados (não
só anterior/próximo) porque o teto prático de pedidos numa página é
baixo (`api.orders({ limit: 100 })`), no máximo 7 páginas — não precisa
de reticências nem lógica de página "por perto". Página atual é
sempre `Math.min(pagina, totalDePaginas)`: se a lista encolher (busca
nova, pedido cancelado some do histórico) e a página guardada não
existir mais, cai para a última válida em vez de mostrar tabela vazia
com botão "anterior" que não faz nada.

## 2026-08-18 — Cancelamento automático de PIX vencido (números "repetidos" no painel)

O dono reportou números de pedido "saindo repetidos" na loja e no painel.
Investigação: a numeração reinicia a cada dia por design (`A001` de hoje
não é o mesmo `A001` de ontem — ver `nextOrderNumber` e o comentário em
`common/timezone.ts`), e o banco tem constraint garantindo que nunca
existam dois pedidos com o mesmo número no mesmo dia (confirmado, zero
duplicatas reais). O que causava a aparência de repetição: **17 pedidos
de dias diferentes (14 a 18/08) nunca chegaram a um status final** e
ficavam todos visíveis ao mesmo tempo no Kanban — um "A001" de dias
atrás ao lado do "A001" de hoje.

Dos 17: 2 eram PIX de verdade vencidos e nunca pagos (um deles da
Vanessa, 17/08 — conferido: QR code de ambiente de TESTE do Mercado
Pago, `ORDTST...`, já expirado havia mais de um dia, não era cliente
real esperando). Os outros 15 eram pedidos de teste (cliente TESTE,
"renan", "brahyam" — nome do próprio dono no git — e 2 manuais sem
telefone). Confirmado com o dono e cancelados todos via
`OrdersService.updateStatus(..., CANCELED)` — não deletados do banco,
para preservar o histórico — o que automaticamente disparou estorno
(no-op, nenhum estava pago), devolução de cupom (nenhum tinha) e
anulação de cashback já creditado (um deles, A007, já tinha R$5,00
creditado por ter passado por PREPARING antes de cancelar — zerado
corretamente pelo `anularCreditoDoPedido`).

**Causa raiz real, corrigida**: só PIX fica parado em `PENDING_PAYMENT`
esperando pagamento — cartão resolve na hora, aprovado ou recusado, na
própria chamada ao Mercado Pago (`OrdersService.create`). Sem nenhum
job cuidando disso, um QR code que ninguém escaneou ficava preso para
sempre: nenhuma tela do painel tem botão para isso, e o pedido nunca
finalizado poluía o Kanban indefinidamente.

`ExpiredPixJob` roda a cada 10 minutos, cancela pedidos PIX cujo
`pixExpiresAt` passou há mais de 10 minutos (a margem existe porque o
webhook do Mercado Pago pode chegar um pouco atrasado mesmo quando o
cliente pagou dentro do prazo — cancelar exatamente no vencimento
arriscaria cancelar um pedido pago, e `avancarPedidoConformePagamento`
só age em pedido ainda `PENDING_PAYMENT`, então um webhook atrasado
demais seria ignorado). O CAS já existente em `updateStatus` protege a
corrida rara: se o pagamento for confirmado bem no meio-tempo, o
cancelamento simplesmente falha com `ConflictException` para aquele
pedido específico, sem derrubar o lote inteiro. Testado ao vivo contra
produção: cancelou exatamente os 2 PIX vencidos de verdade, mais nada.

## 2026-08-18 — Cashback passa a creditar em PREPARING, não em DELIVERED/COMPLETED

Mudança de regra pedida diretamente: o cliente quer ver o saldo crescer
assim que a cozinha começa a preparar, não só depois de entregue/retirado.
Substitui a decisão anterior (crédito só na entrega), registrada mais
abaixo neste arquivo.

Contrapartida aceita conscientemente: como `PREPARING → CANCELED` é uma
transição válida, um pedido pode ser cancelado DEPOIS de já ter gerado
crédito — e esse crédito pode até já ter sido gasto em outro pedido, se
o cliente foi rápido. `CashbackService.anularCreditoDoPedido()` zera o
que ainda não foi gasto no cancelamento (mesmo padrão já usado para
devolver o uso de cupom); o que já foi gasto fica como perda aceita, do
mesmo jeito que estornar um pedido não tira de volta o produto já
entregue por causa dele. Roda na MESMA transação da mudança de status,
não depois — é escrita pura no banco, sem chamada de rede envolvida.

Verificado ao vivo: pedido criado, avançado só até PREPARING (sem
avançar mais) já aparece com saldo disponível na consulta que o
checkout usa; cancelado em seguida, o saldo volta a zero. Dados de
teste removidos depois.

## 2026-08-18 — "Saldo de cashback somando infinitamente": ledger investigado, não era bug

O dono reportou que, depois de o cliente de teste gastar todo o saldo,
o valor "não resetava" e continuava crescendo. Reconstruí a sequência
real de 4 pedidos do cliente de teste (dados de produção) somando
crédito x consumo: total creditado R$7,38, total gasto R$6,12, saldo
restante R$1,26 — bate exatamente com a soma de `remainingCents` no
banco. Também reproduzi o mesmo cenário do zero (creditar, gastar tudo,
conferir zero, gerar novo crédito, conferir que não soma com o antigo)
e o resultado bateu certo nos dois casos.

Conclusão: o R$1,26 que pareceu "não resetado" era cashback NOVO,
legitimamente ganho no último pedido da sequência — todo pedido
concluído gera cashback de novo, isso é o programa funcionando, não um
saldo antigo que sobrou.

O que era real: o painel de Cashback (`staleTime: 60_000`) não se
atualizava sozinho quando o status de um pedido mudava na aba Pedidos
— quem estivesse com as duas abas abertas veria um número desatualizado
por até 1 minuto. Corrigido invalidando a query `['cashback']` no
`onSuccess` da mutação de status, e com `refetchInterval: 30_000` como
rede de segurança para quem só tem a aba Cashback aberta.

## 2026-08-18 — Painel de pedidos não tinha coluna depois de "Prontos"

Motivo real por trás de "o cashback não aparece no checkout": a lógica
de saldo, crédito e consulta sempre esteve correta — verificado de
ponta a ponta criando um pedido de teste, avançando pelo mesmo
`OrdersService.updateStatus()` que o painel chama, e conferindo o
crédito gerado e a resposta de `GET /cashback/saldo` (depois removido,
sem deixar rastro).

O problema estava um passo antes: `CashbackService.creditarPorPedido()`
só roda quando o pedido chega a `DELIVERED`/`COMPLETED`, e **nenhum
pedido no banco jamais chegou lá**. O Kanban do painel
(`OrdersPage.tsx`) tinha colunas só até `READY` — `PENDING_PAYMENT`,
`CONFIRMED`, `PREPARING`, `READY`. A máquina de estados
(`order-status.ts`) vai além: `READY → OUT_FOR_DELIVERY/AWAITING_PICKUP
→ DELIVERED/COMPLETED`. Ao clicar em "avançar" num pedido pronto, ele
saía da lista de colunas e caía direto no "Histórico recente" — que é
só leitura, sem nenhum botão. O pedido ficava preso ali para sempre, e
o crédito de cashback nunca disparava para ninguém.

Corrigido adicionando as duas colunas que faltavam (`Saiu para entrega`,
`Aguardando retirada`), reaproveitando 100% do componente `CartaoPedido`
já existente — o botão "avançar" já calculava a transição certa via
`nextStatusFor` (`DELIVERED` para entrega, `COMPLETED` para retirada),
só não tinha onde aparecer. Grid mudou de `xl:grid-cols-4` para
`xl:grid-cols-3`, para as 6 colunas caberem em duas fileiras cheias em
vez de uma de 4 e outra de 2 soltas.

Os 4 pedidos que estavam presos em `OUT_FOR_DELIVERY` na produção eram
todos do cliente de teste (`TESTE`, telefone `11970706978`) — nenhum
cliente real afetado.

## 2026-08-17 — Rate limiting contava o IP do Cloudflare, não o do cliente

Descoberto ao verificar em produção a correção do throttler (logo
abaixo): o limite funcionava local, mas **não** em produção. Mesmo teste,
resultados opostos.

A causa: a cadeia real é **Cloudflare → proxy do Railway → app**, dois
saltos, e o `trust proxy` estava em `1`. O `req.ip` — que o
`ThrottlerGuard` usa como chave — parava numa **borda do Cloudflare** em
vez de chegar no cliente.

Duas consequências, as duas ruins:
- **o mesmo cliente contava como vários**: o Cloudflare distribui
  conexões entre bordas, então cada requisição podia cair num contador
  novo. Medido: 7 chamadas seguidas passavam numa rota de limite 5/min,
  enquanto as mesmas 7 **na mesma conexão** eram barradas na 6ª — foi
  esse contraste que denunciou o problema;
- **clientes diferentes contavam como um só**: quem sai pela mesma borda
  divide o contador, e um abusador derrubaria terceiros junto.

Corrigido com um `IpRealThrottlerGuard` que usa `CF-Connecting-IP`
(posto pelo próprio Cloudflare, não falsificável pelo cliente), com
`req.ip` de fallback para desenvolvimento local. O `trust proxy` também
passou para `2`, refletindo a topologia real — mas a segurança não
depende dele: depende do cabeçalho.

Verificado nos dois sentidos antes de subir: IPs diferentes têm
contadores independentes, e o mesmo IP é barrado na 6ª tentativa.

## 2026-08-17 — Rate limiting por rota estava INERTE no projeto inteiro

Achado durante a auditoria do módulo de WhatsApp, mas o efeito era
geral. `ThrottlerModule.forRoot()` registrava três janelas nomeadas
`short`, `medium` e `long` — mas todos os `@Throttle({ default: {...} })`
espalhados pelos controllers procuram um throttler chamado **`default`**.
Como nenhum tinha esse nome, **a metadata nunca era encontrada e o limite
por rota simplesmente não valia**, em silêncio.

Afetava 10 rotas, incluindo as mais sensíveis: `/auth/admin/login`
(proteção contra força bruta), criação de pedido, rastreio de pedido
(a rota que já teve correção de LGPD) e o webhook do Mercado Pago.

**Confirmado empiricamente**, antes e depois: 8 chamadas seguidas numa
rota que declarava limite de 5/min passavam todas; depois de renomear a
janela de 1 minuto de `long` para `default`, a 6ª passou a receber 429.

Correção de uma linha (o nome da janela) em vez de editar 10 arquivos —
e as janelas `short`/`medium` continuam valendo como proteção de rajada
por cima do limite específico de cada rota.

## 2026-08-17 — Integração WhatsApp Cloud API, dormente até ter credencial

Módulo `whatsapp/` completo e **desligado por padrão**. Com
`WHATSAPP_ENABLED=false`, nenhuma chamada sai para a Meta: registra no
log o que enviaria e devolve sucesso *simulado*. Ligar é só preencher
variável de ambiente — nenhuma linha de código muda.

**`simulado` é parte do contrato de retorno.** Distingue "a Meta
aceitou" de "está desligado e só foi registrado". Quem grava "aviso
enviado" precisa checar esse campo: o job de cashback **não** carimba
`expiryWarningSentAt` em envio simulado, senão marcaria como avisado
quem nunca recebeu nada — e no dia em que a integração fosse ligada,
essas pessoas já apareceriam como resolvidas.

**Falha no boot se ligar sem credencial.** `WHATSAPP_ENABLED=true` sem
token ou phone number id derruba a inicialização com a lista do que
falta. Sem isso, errar o nome de uma variável no Railway (fácil: existe
`WHATSAPP_PHONE_NUMBER` **e** `WHATSAPP_PHONE_NUMBER_ID`) faria o
sistema subir "funcionando" e simular tudo — descoberto só pela
reclamação de um cliente.

**Cliente HTTP separado do serviço.** `MetaGraphClient` cuida de URL
versionada, auth, timeout, retry e tradução de erro, sem saber o que é
pedido ou cliente. Quando entrar outra chamada à Graph API (consultar
template, listar números), ela reaproveita em vez de repetir tudo.

**Retry só no que adianta repetir.** Token inválido, template reprovado
e número que não recebe têm resposta idêntica na segunda tentativa —
repetir só atrasa o diagnóstico. Limite de conta também **não** é
repetido, apesar do nome: as janelas da Meta são de horas, e o backoff
aqui é de ~1,2s no total; três tentativas seriam três chamadas
garantidamente perdidas.

**Log é saneado, não cru.** A primeira versão mascarava o telefone num
campo e despejava o payload inteiro logo ao lado — com o número completo
em `to` e o nome do cliente nos parâmetros do template. A auditoria
pegou; `sanitizarPayload()` mantém o que serve para depurar (tipo, nome
do template, quantas variáveis, tamanho) e troca os valores por
marcadores.

**Webhook falha fechado.** Sem `WHATSAPP_APP_SECRET` não há como
conferir a assinatura HMAC, então recusa tudo. Aceitar evento não
verificado deixaria qualquer um forjar "mensagem entregue" — mesmo
critério do webhook do Mercado Pago. Exigiu `rawBody: true` no
bootstrap: a assinatura é sobre os bytes originais, e reserializar o
JSON já parseado mudaria espaços e ordem de chaves.

**Códigos de erro da Meta revisados na auditoria.** A primeira versão
tinha três errados, todos com custo real de diagnóstico: `133010` não é
"número do cliente inválido" e sim **o número da loja não registrado**
(faria procurar defeito no telefone do cliente por horas); `131005` é
"access denied", não indisponibilidade (queimava 3 tentativas e apontava
para o lado errado); `131052` é erro de mídia, não número inexistente.
Adicionados os que faltavam e mais doem na prática: `131042`
(faturamento pendente — o erro nº 1 ao ligar a integração) e `131049`
(Meta optou por não entregar, que é o que costuma barrar template de
marketing como o de cashback).

**Só um template precisa de aprovação agora.** Os seis métodos de
mensagem de pedido (`sendOrderReceived` etc.) existem, mas **nenhum
ponto do código os chama** — só serão acionados quando o fluxo de pedido
for integrado. Marcado com `emUso` no catálogo e exposto em
`GET /whatsapp/status` como `precisaAprovarAgora`, para ninguém esperar
dias pela Meta por mensagem que não vai sair.

## 2026-08-17 — Cashback de 5% com validade e aviso no WhatsApp

Programa de fidelidade: 5% do valor pago volta como crédito, válido por
20 dias, usável no próximo pedido. Aviso automático no WhatsApp um dia
antes de expirar.

**Modelo de LOTES, não um saldo único no cliente.** Um campo
`cashbackCents` no `Customer` seria mais simples, mas não teria como
responder "quanto expira amanhã?" — que é exatamente a informação do
aviso. Cada pedido concluído vira um `CashbackCredit` com validade
própria; o saldo é a soma do que ainda vale. Gastar consome primeiro o
que vence antes (FIFO por `expiresAt`), para o cliente nunca perder
valor que daria para ter usado.

**Regras comerciais no banco, não no código** (`store.cashbackPercent`,
`cashbackExpiryDays`, `cashbackMaxRedeemPercent`): mudar o percentual ou
a validade é decisão de negócio e não deveria exigir deploy. Zerar
`cashbackPercent` desliga o programa inteiro.

**Credita só quando o pedido é concluído** (`DELIVERED`/`COMPLETED`), e
não na confirmação. Creditar antes obrigaria a "tirar de volta" no
cancelamento — e se o cliente já tivesse gasto o saldo, o resultado
seria saldo negativo, com toda a complicação de cobrar de volta. Decisão
do dono da loja.

**A base é o valor pago EM DINHEIRO**: subtotal − cupom − cashback
usado. Duas consequências deliberadas:
- cashback não gera cashback, senão o saldo se realimentaria sozinho;
- a taxa de entrega fica de fora — ela vai integral para quem entrega,
  então devolver 5% dela sairia direto da margem da loja.

**Teto de resgate por pedido** (`cashbackMaxRedeemPercent`, hoje 50%):
sem ele, um pedido inteiro sairia pago só com saldo acumulado, sem
dinheiro novo entrando. É configurável justamente porque é uma escolha
comercial, não técnica.

**O valor de resgate que vem do navegador é só um PEDIDO.** O servidor
recalcula o saldo real e o teto dentro da transação e usa o menor valor
— mesma regra que já vale para preço (ver o topo de
`createOrderSchema`). Confiar no número enviado deixaria qualquer um
zerar o próprio pedido pelo DevTools.

**`consumir()` roda DENTRO da transação de criação do pedido**: se a
criação falhar adiante, o saldo debitado volta junto no rollback, em vez
de sumir sem pedido nenhum para mostrar. E o `updateMany` com o
`remainingCents` esperado no `WHERE` impede que dois pedidos simultâneos
do mesmo cliente gastem o mesmo crédito duas vezes (mesmo padrão
compare-and-swap da auditoria de ontem).

**`createMany` com `skipDuplicates` em vez de `create` em try/catch**
para creditar: o resultado é o mesmo (a constraint `@@unique([orderId])`
é quem garante que um pedido nunca gera dois créditos), mas o caminho
"já existia" não passa por exceção — não suja o log com um erro de
Prisma que na verdade é o comportamento esperado.

**WhatsApp: Cloud API oficial, e o serviço nasce DORMENTE.** Sem
`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`, o `WhatsAppService`
registra no log o que teria enviado e segue — assim todo o resto do
cashback roda e é testável em produção antes de a conta Meta estar
pronta, sem nenhum `if` espalhado pelo código de negócio. Mantida a
decisão original do projeto de não usar Baileys/Venom (violam os termos
e levam a banimento do número comercial).

**Mensagem iniciada pela loja exige template aprovado pela Meta.** Texto
livre só é permitido dentro da janela de 24h depois de o cliente mandar
mensagem — o aviso de expiração não se encaixa nisso. Por isso o serviço
só envia template, com variáveis posicionais (`{{1}}`, `{{2}}`).

**Aviso um dia antes, às 10h no fuso da loja.** Um dia dá tempo de a
pessoa fazer o pedido e ainda cria urgência; avisar no próprio dia
frustra quem só viu à noite. 10h porque a loja abre 18h — cedo para
planejar o jantar, tarde para não acordar ninguém. O `expiryWarningSentAt`
impede mandar a mesma mensagem duas vezes se o job rodar de novo no
mesmo dia (redeploy, execução manual), e só é carimbado **depois** do
envio confirmado — se a Meta recusar, o cliente continua elegível.

**Rota pública de saldo devolve só valores, nunca nome.** O checkout é
de convidado (não existe login de cliente), então a consulta é pelo
telefone. Devolver só números significa que, mesmo que alguém varra
telefones, não consegue montar uma base de clientes — só descobre saldos
avulsos. Somado ao throttle apertado e à exigência do telefone completo,
é o mesmo raciocínio da correção de LGPD do rastreio de pedido.

## 2026-08-16 — Auditoria geral: concorrência, CSV do dashboard, limpeza

Auditoria completa do projeto (backend, frontend, banco, deploy,
dependências). Resumo do que foi corrigido — detalhe de cada item nos
commits do dia.

**Condição de corrida em `updateStatus()` — a correção mais importante.**
`OrdersService.updateStatus()` lia o status do pedido, validava a
transição, e só DEPOIS escrevia — sem lock nem comparação atômica entre
a leitura e a escrita. Duas requisições concorrentes no mesmo pedido
(duplo clique em "cancelar", ou o webhook do Mercado Pago e um admin
agindo ao mesmo tempo) passavam as duas pela validação antes de
qualquer uma escrever, e as duas aplicavam a transição: duas linhas em
`OrderStatusHistory`, `coupon.usageCount` decrementado duas vezes, e
`refundIfPaid` podendo disparar **estorno duplicado de verdade na
Mercado Pago** (as duas leituras viam o pagamento ainda como `PAID`
antes de qualquer uma marcar `REFUNDED`).

Corrigido com **compare-and-swap**: `tx.order.update({ where: { id } })`
virou `tx.order.updateMany({ where: { id, status: statusLido } })`, e o
`count` do resultado diz se a escrita realmente aconteceu. `count === 0`
= alguém mexeu no pedido entre a leitura e a escrita — lança
`ConflictException` em vez de aplicar a mudança por cima. Mesma correção
em `PaymentsService.avancarPedidoConformePagamento` (o caminho do
webhook), que é um caminho de escrita **totalmente separado** de
`updateStatus()` e por isso tinha o mesmo bug de forma independente —
um não sabe da existência do outro. Testes em
`orders.service.test.ts`/`payments.service.test.ts` cobrem os dois.

**Colisão na criação do pedido.** `nextOrderNumber()` conta pedidos do
dia e monta o número sem lock (`count()` depois `create()`, sem nada
entre os dois). Dois pedidos DIFERENTES (não só duplo clique do mesmo
cliente) podiam calcular o mesmo número em horário de pico e colidir na
constraint `@@unique([storeId, orderDate, number])` — quem perdesse a
corrida recebia um "erro inesperado" (500) genérico mesmo com dados
válidos. Mesmo risco para colisão de `idempotencyKey` (duplo
clique/retry de rede chegando quase junto). Corrigido com
`criarPedidoComRetentativa()`: tenta a transação, e se cair num P2002
(unique constraint), decide o que fazer conforme QUAL constraint foi
violada — colisão de `idempotencyKey` devolve o pedido que a outra
requisição concorrente já criou; colisão de número tenta a transação de
novo (até 3x), porque na próxima volta o `count()` já enxerga o pedido
que acabou de ser gravado. Usado tanto no checkout público quanto no
pedido de balcão — as duas passam pelo mesmo `nextOrderNumber()`.

**Export de CSV do dashboard estava quebrado.** `<a href={url}
download>` nunca poderia funcionar: o token de acesso do admin vive só
em memória (de propósito, por segurança), e uma navegação de link
simples não tem como anexar o header `Authorization`. Todo clique em
"⬇ CSV" resultava em 401 silencioso. Trocado por um fetch autenticado
(reaproveitando a mesma renovação de sessão no 401 que o resto do
painel já usa) que baixa o CSV como Blob e dispara "Salvar como" via
link temporário — nunca aponta pra URL da API diretamente.

**Sourcemaps de produção estavam publicamente expostos.** Confirmado
com `curl` antes de mexer: `painel.impactdev.site/assets/*.js.map` e
`loja.impactdev.site/assets/*.js.map` respondiam 200, expondo
código-fonte legível (comentários, nomes de função, lógica de negócio)
a qualquer um. Não há nenhum serviço (Sentry ou equivalente) consumindo
esses mapas hoje — `sourcemap: false` nos dois `vite.config.ts`.

**Busca de pedidos sem debounce.** Cada tecla digitada em "Buscar
pedido" no painel virava uma chamada HTTP nova (a `queryKey` mudava a
cada letra). Adicionado debounce de 300ms — o campo continua respondendo
instantaneamente (estado separado do que dispara a busca).

**Dependências removidas** (zero uso confirmado por grep, depois
validado com build+test+typecheck): `@nestjs/config` e `@nestjs/terminus`
na API (health check é feito à mão, nunca usou o Terminus);
`react-hook-form`, `@hookform/resolvers` e `zod` direto no storefront
(o checkout usa `useState` puro; `zod` já vem transitivamente via
`@adventure/shared`). `REDIS_URL` também saiu do schema de ambiente —
nunca foi lido em lugar nenhum do código nem documentado no
`.env.production.example` (diferente de `WHATSAPP_PHONE_NUMBER`, que
ficou: está documentado como próxima fase).

**O que foi encontrado mas NÃO foi mexido, de propósito:**
- `products-admin.service.ts` (`update`/`replaceImage`/`removeImage`)
  não isola por `storeId`, embora o schema seja multi-loja. Inofensivo
  hoje (uma loja só no banco inteiro) — vira falha de IDOR no dia que
  existir uma segunda loja. Corrigir agora seria proteger contra uma
  ameaça que não existe ainda.
- Enumeração de conta admin via mensagem de bloqueio (403 específico
  "conta bloqueada" vs 401 genérico "e-mail ou senha incorretos") — a
  troca certa reduziria a segurança percebida (o admin de verdade
  perderia a mensagem útil "tente de novo em X min") por um ganho de
  segurança pequeno, já bem mitigado pelo rate limit + bloqueio de
  conta existentes.
- `PaymentWebhookEvent`, `DailySalesRollup`, `ProductSalesRollup`
  (tabelas do schema nunca escritas nem lidas) e `AdminRole.DELIVERY`
  (nenhuma rota aceita esse papel) — desenhadas para uma fase futura,
  nunca conectadas. Completar isso é funcionalidade nova, não correção
  de bug; o dashboard já agrega direto no banco via SQL (`aggregate`/
  `groupBy`/`$queryRaw`), então a ausência do rollup não é um problema
  de performance hoje.
- `CryptoService.safeEqual()` e `salesReportSchema`/`SalesReportInput`
  (código morto, zero uso fora de teste) ficaram — são pequenos,
  inofensivos, e `safeEqual` é infraestrutura de segurança
  (comparação em tempo constante) genuinamente útil de manter à mão.

## 2026-08-15 — Pedido de balcão: cliente opcional e fluxo próprio

A cozinha ganhou a aba **Balcão** para lançar a venda feita
presencialmente. Duas decisões estruturais por trás disso:

**`Order.customerId` virou opcional.** Quem compra no balcão quase nunca
deixa telefone — e telefone é justamente a identidade do `Customer`
(`@@unique([storeId, phone])`). As alternativas eram piores: exigir
telefone faria a cozinha inventar número para conseguir fechar a venda, e
um "cliente Balcão" fixo e compartilhado colocaria um telefone falso numa
coluna de telefone, que alguém uma hora usaria para mandar mensagem.
Pedido de balcão sem telefone simplesmente **não tem cliente**, e o DTO
devolve `customer: null` inteiro — e não um objeto com campos vazios, que
passaria despercebido em quem consome.

**`manualCustomerName` é uma coluna separada, não `notes`.** Sem
`Customer`, o nome dito no balcão ("João") precisa morar em algum lugar —
mas em `notes` ele se misturaria com observação do pedido ("sem cebola"),
que é outra coisa e aparece em outro lugar da tela da cozinha. Com
telefone informado, o nome vai para o `Customer` e a coluna fica nula;
`nomeDoCliente()` no painel concentra essa escolha num lugar só.

**`createManual()` é um caminho próprio, não `create()` com campos
opcionais.** Cada diferença abaixo seria um bug se o fluxo fosse
compartilhado:

- **não checa horário de funcionamento** — se há alguém no balcão
  pedindo, a loja está aberta de fato; recusar a venda porque a agenda diz
  que fechou seria o sistema discutindo com a realidade e perdendo
  dinheiro;
- **não aplica pedido mínimo** — mínimo existe para valer a pena mandar
  entregador, e aqui não sai entregador;
- **não cria cobrança no Mercado Pago**, nem para PIX (no balcão é o QR
  fixo da loja). O dinheiro entra na mão ali; o campo só registra **como**
  entrou, para o fechamento do caixa;
- **já nasce `CONFIRMED`** — não há pagamento online a esperar.

O preço continua vindo do servidor: o balcão manda o que foi pedido,
nunca quanto custa — mesma regra do site. E o `changedByAdminId` do
primeiro `OrderStatusHistory` registra quem bateu a venda, que é dinheiro
entrando na mão e precisa de responsável.

**Reaproveita `CASH_ON_DELIVERY`/`CARD_ON_DELIVERY`** em vez de criar
valores novos no enum. Os rótulos dizem "na entrega", mas o painel já
mostra o pedido como 🧾 Balcão, e a alternativa (migração de enum no
Postgres + rótulos + `isOnlinePayment` + storefront) custaria bem mais do
que resolve. Se um dia o relatório precisar separar "dinheiro no balcão"
de "dinheiro na entrega", a coluna `isManual` já dá essa quebra.

## 2026-08-15 — Rastreio de pedido exigindo telefone; adequação LGPD

**Vazamento.** `GET /orders/track/:number` era `@Public()` sem
verificação nenhuma além do número — e o número é curto, sequencial por
dia e portanto trivialmente enumerável ("A001", "A002"...). Qualquer um
percorrendo a sequência lia nome, telefone e endereço completo de
qualquer cliente da loja. Pior: `POST /orders/track/:number/cancel`
tinha exatamente o mesmo buraco e ainda **deixava cancelar o pedido de
outra pessoa**, só sabendo o número.

**Correção.** As duas rotas agora exigem o telefone usado no pedido
(`trackOrderQuerySchema`/`cancelOrderSchema.phone`, ambos usando o mesmo
`phoneSchema` do cadastro). Número certo com telefone errado devolve o
**mesmo** 404 genérico de número inexistente — de propósito, para não
dar como consultar quais números existem por tentativa e erro. A rota
`GET` ganhou `@Throttle` (não tinha nenhum antes): na prática virou uma
tentativa de login, e merece o mesmo limite que uma.

**Storefront.** `/pedido/:number` agora pede o WhatsApp antes de mostrar
qualquer coisa (`OrderGate` em `TrackPage.tsx`), a menos que o telefone
já esteja em `sessionStorage` desta aba — o que acontece automaticamente
logo após o checkout, para a pessoa não digitar o mesmo número duas
vezes na mesma visita (`telefoneDoPedido.ts`). `sessionStorage`, não
`localStorage`, de propósito: some ao fechar a aba, não é um "lembrar de
mim" permanente guardando telefone de cliente indefinidamente no
navegador de qualquer um que use o mesmo computador depois.

**Resto da adequação LGPD, no mesmo commit:**
- Checkbox de consentimento explícito no checkout, linkando para
  `/privacidade` (`PrivacidadePage.tsx`, nova) — cobre coleta, uso,
  compartilhamento com a Mercado Pago, retenção, direitos do titular e
  como exercê-los. **Tem um `[CNPJ]` propositalmente pendente** — não
  existe CNPJ cadastrado em nenhum lugar do projeto, e não é algo para
  inventar. Preencher antes de considerar a página "publicada" de
  verdade.
- Rodapé com link para a política em storefront, admin e landing (os
  três únicos pontos de rodapé do projeto — ver mapeamento).
- E-mail de admin removido de um log (`2FA ativado para ${admin.email}`
  → usa o id): dado pessoal em log sem necessidade nenhuma de estar ali.

**O que NÃO foi feito, de propósito.** Endpoint de exportação/exclusão
automática de dados do cliente não existe — hoje não há sequer módulo
de "conta de cliente" (o checkout é sempre convidado). Construir um
fluxo de autoatendimento para isso é desproporcional para o tamanho do
sistema agora; a política de privacidade cobre esse direito via contato
direto pelo WhatsApp da loja, o que é uma prática aceita para negócios
deste porte. Se o volume de pedidos crescer muito, vale reconsiderar.

## 2026-08-15 — Aviso sonoro sintetizado, não o arquivo do iPhone

O painel toca um aviso quando entra pedido em "Aguardando pagamento" ou
"Novos". O pedido era "o som padrão de notificação do iPhone" — e o som
é **sintetizado com a Web Audio API** (`lib/som.ts`), não é o arquivo da
Apple.

**Por quê.** O "Tri-tone" é da Apple; embutir o arquivo no repositório
seria redistribuir áudio proprietário. O que está lá é um trio de notas
de sino com a mesma ideia — curto, agudo, reconhecível na cozinha
barulhenta. De quebra evita um binário no repo e uma requisição a mais.
**Se alguém for "melhorar" isso trocando por um .mp3 do toque original,
o problema volta.**

**Destravar o áudio.** Navegador só libera som depois de interação com a
página, e o aviso toca sozinho (o pedido chega pelo refetch de 15s, sem
ninguém clicar). Por isso o `AudioContext` é destravado no primeiro
clique em qualquer lugar do painel, e também no botão 🔔 — que ao ligar
já toca o aviso, servindo de teste de volume.

**Não avisar de novo o que já era conhecido.** O gatilho compara
**ids**, não quantidade: a fila também encolhe (pedido avança, pedido é
cancelado), então contar erraria nos dois sentidos. E a memória não é
atualizada enquanto a lista não representa a fila real — durante o
carregamento inicial (senão todo pedido já existente contaria como
recém-chegado) e com busca ativa (senão limpar a busca faria os pedidos
filtrados "chegarem de novo").

**Ficha do cliente por portal.** O popover de dados do cliente
(`DadosDoCliente`) é renderizado com `createPortal` e posição fixa, e não
posicionado de forma absoluta dentro do card: a tabela do histórico vive
num `overflow-x-auto`, que recortaria a ficha.

## 2026-08-15 — Cancelar pedido pago não estornava na Mercado Pago

**Sintoma.** Cancelei o pedido A003 (pago no cartão, R$ 45,00) pelo
painel para testar. O pedido virou `CANCELED` no banco normalmente, mas
consultando direto na Mercado Pago a cobrança continuava
`processed / accredited` — sem nenhum estorno. O dinheiro ficaria preso
com o cliente cobrado e a loja sem devolver.

**Causa raiz.** `OrdersService.updateStatus()` sempre só atualizou o
`status` do pedido e o histórico — nunca teve nenhuma chamada à Mercado
Pago. Fazia sentido para pedido ainda não pago (PIX pendente, dinheiro/
maquininha na entrega — não há o que estornar), mas pedido já pago com
cartão ou PIX ficava sem estorno automático nenhum, silenciosamente.

**Correção.** `PaymentsService.refundIfPaid(orderId, orderNumber)`: busca
o `Payment` mais recente do pedido com `status: PAID`; se não houver
(pedido nunca foi cobrado pela Mercado Pago), não faz nada. Se houver,
chama `MercadoPagoService.refundOrder()` (`POST /v1/orders/{id}/refund`
da Orders API, via SDK — estorno total, sem corpo) e marca o `Payment`
como `REFUNDED`. `OrdersService.updateStatus()` chama isso sempre que a
transição é para `CANCELED`, **depois** de commitar a transação do banco
(mesmo motivo do PIX em `PaymentsService`: chamada de rede não deveria
acontecer com transação de banco aberta).

**Falha no estorno não bloqueia o cancelamento.** Se a chamada à Mercado
Pago falhar (fora do ar, timeout), o pedido já está `CANCELED` — é mais
importante a cozinha parar na hora do que travar o cancelamento esperando
a Mercado Pago responder. A falha fica registrada bem alto no log
(`ESTORNO FALHOU: pedido ... nao foi estornado ... Estorne manualmente`)
para conciliação manual, mesmo padrão da "COBRANÇA ÓRFÃ" já usado na
criação do PIX.

**Idempotência.** `refundOrder()` usa `idempotencyKey: refund-${externalId}`
— um retry (nosso ou de rede) devolve o mesmo estorno em vez de tentar
estornar duas vezes a mesma cobrança.

## 2026-08-15 — Número do pedido: unicidade escopada por dia, não global

**Sintoma.** `POST /orders` dava 500 ("erro inesperado") de forma
consistente — em **qualquer** forma de pagamento, incluindo dinheiro e
maquininha na entrega, que nem tocam o Mercado Pago. Só aconteceu a
partir do segundo dia de uso real do sistema.

**Causa raiz.** `number` (o código curto tipo "A001", gritado na
cozinha) era gerado contando pedidos do dia e reiniciando em "A001" a
cada dia — mas a constraint `@@unique([storeId, number])` era **global**,
sem noção de dia nenhuma. No segundo dia, o primeiro pedido tentava
gravar "A001" de novo e colidia com o "A001" do dia anterior, que
continua no banco. `tx.order.create()` estourava `P2002` sem tratamento,
e o filtro de erro devolvia 500 genérico — daí a mensagem não dar pista
nenhuma de que era colisão de número.

**Por que só apareceu agora.** É a primeira vez que o sistema teve
pedidos reais (ou de teste, sem limpeza) sobrevivendo de um dia para o
outro. Em toda sessão de teste anterior os pedidos foram criados e
apagados no mesmo dia — a colisão nunca teve chance de acontecer.

**Correção.** Nova coluna `orderDate` (`DATE`, no fuso da loja — ver
`common/timezone.ts`), preenchida a partir de `createdAt` para os pedidos
já existentes. A constraint virou `@@unique([storeId, orderDate,
number])`, e `nextOrderNumber()` conta por `orderDate` exato em vez de
`createdAt >= inicio do dia`.

**Efeito colateral que também precisou de correção.** Com `number`
deixando de ser globalmente único de propósito, "A001" de hoje e "A001"
de duas semanas atrás são pedidos diferentes — `findByNumber()` (usado
por `GET /orders/track/:number`, a tela pública de acompanhamento) e
`cancelByCustomer()` buscavam só por `number`, sem `orderBy`, arriscando
devolver o pedido errado (ou um resultado não-determinístico do Postgres)
assim que o mesmo número se repetisse. Os dois agora ordenam por
`createdAt: 'desc'` e pegam o mais recente — é o que a pessoa quase
certamente quer dizer ao digitar um número que acabou de receber.

**`orderDate` como `Date`, não como string, no código.** A `data` do
`create()` aceitou uma string "YYYY-MM-DD" de boa, mas o `where` do
`count()` não — `PrismaClientValidationError` em runtime, silencioso no
`tsc` porque o tipo gerado aceita as duas formas nos dois lugares (só
uma delas funciona de verdade). `hojeNoFusoDaLoja()` devolve `Date` desde
o início para não depender de qual operação Prisma vai usar o valor.

**Fuso duplicado, unificado.** `store.service.ts` já tinha essa exata
logica (`STORE_TIMEZONE = 'America/Sao_Paulo'`) para o horário de
funcionamento, com o mesmo comentário sobre o servidor rodar em UTC.
Virou `common/timezone.ts`, importado pelos dois lugares — duas contas
de "hoje" divergentes foi exatamente a familia de bug que causou isso.

**Migration com backfill em 3 passos**, porque já existem pedidos:
coluna nullable → `UPDATE` a partir de `createdAt` (convertido de UTC
"nu" para o fuso da loja com `AT TIME ZONE 'UTC' AT TIME ZONE
'America/Sao_Paulo'`, na ordem certa) → `NOT NULL`. Testada inteira
dentro de uma transação com `ROLLBACK` proposital antes de aplicar de
verdade — não há banco de staging neste projeto.

---

## 2026-08-14 — Cartão de crédito: Secure Fields e `fetch` cru na recusa

**O que mudou.** "Cartão de crédito" no checkout passou a funcionar de
verdade. Antes a opção existia mas não cobrava nada: o pedido nascia em
`PENDING_PAYMENT` e ficava **preso para sempre**, sem QR Code nem tela de
cartão — a cozinha nunca via. Era pior que não oferecer.

**Cartão aprova na hora, PIX não.** O Mercado Pago responde aprovado ou
recusado na própria chamada (`processing_mode: automatic`). Então o pedido
pago no cartão vai **direto para `CONFIRMED`**, sem passar por "aguardando
pagamento" e sem depender de webhook. Só o PIX espera confirmação.

**Os dados do cartão nunca tocam o servidor.** O navegador usa os *Secure
Fields* do Mercado Pago — número, validade e CVV vivem dentro de iframes
deles, e o que sai é um token de uso único. Só o token chega na nossa API.
Isso mantém o sistema fora do escopo pesado de PCI-DSS: um vazamento nosso
não expõe cartão de ninguém.

**Secure Fields em vez do Card Payment Brick.** O Brick é menos código,
mas renderiza o próprio botão de envio e o próprio layout — brigaria com
o checkout, que tem um botão único de "Confirmar pedido" no fim e um tema
escuro próprio. Com Secure Fields controlamos o formulário e tokenizamos
no submit, encaixando no fluxo que já existia.

**O token é gerado no envio, não enquanto digita.** Ele vale uma vez só e
expira; gerar antes correria o risco de chegar velho na API se a pessoa
demorasse a terminar o resto do formulário.

**A cobrança no cartão usa `fetch` cru, não o SDK — e isso é deliberado.**
Numa recusa, o Mercado Pago responde 402 com o motivo em
`errors[].details` (`insufficient_amount`, `bad_filled_card_data`,
`rejected_by_issuer`...). O erro que o SDK constrói **joga esse campo
fora**: sobra `MercadoPago API error`, sem motivo (verificado na prática —
`causes` vem vazio e `errors` vem `undefined`). Num cartão recusado o
motivo é a informação mais importante que existe: "sem limite" e "dados
incorretos" pedem ações opostas do cliente, e uma mensagem genérica faria
a pessoa tentar o mesmo cartão de novo ou desistir achando que o site
quebrou. Por isso essa chamada é feita direto, para preservar o corpo do
erro. O PIX continua pelo SDK, onde isso não faz falta.

**Chave pública versionada de propósito.** `VITE_MERCADOPAGO_PUBLIC_KEY`
fica no `.env.production` do storefront, junto da `VITE_API_URL`. Ela é
feita para ficar exposta no navegador — só serve para tokenizar, nunca
para cobrar. O Access Token, esse sim, continua só no Railway. Sem a
chave configurada, a opção de cartão **some do checkout** em vez de gerar
pedido impagável.

**Testado com os cartões de teste do Mercado Pago**, pelo fluxo real da
API: aprovado (`APRO`) → pedido `CONFIRMED` + `Payment` `PAID` com
`paidAt`; e as recusas `FUND`, `SECU` e `OTHE` → pedido cancelado, nunca
de pé sem pagamento, cada uma com sua mensagem específica.

---

## 2026-08-14 — Limite de transação de 20s: a conexão do Neon fecha quando ocioso

**Sintoma.** Finalizar pedido na loja dava "Ocorreu um erro inesperado"
(500) de forma intermitente. Tentar de novo logo em seguida funcionava.
Parecia falha do PIX, mas não era: nenhum pedido chegava a ser gravado —
o erro acontecia antes de qualquer coisa relacionada a pagamento.

**Causa raiz, pelos logs do Railway:**

```
prisma:error Error in PostgreSQL connection: Error { kind: Closed }
Transaction API error: Transaction already closed: ... The timeout for
this transaction was 5000 ms, however 5191 ms passed since the start.
```

O Neon encerra a conexão quando o banco fica ocioso. O primeiro pedido
depois de uma pausa cai numa transação que precisa **reconectar antes de
rodar as consultas** — e só a reconexão, a partir do Railway, consome
alguns segundos. Com o limite padrão do Prisma (5s), estourava por pouco
(5191ms medidos). A transação em si leva ~700ms com a conexão ativa.

**Correção.** `transactionOptions` no `PrismaService`: `timeout` de 20s e
`maxWait` de 10s. Não é mascarar lentidão — a folga só existe para o caso
excepcional da reconexão e não muda nada no caminho normal. É exatamente
o que a mensagem de erro do Prisma recomenda.

**Como foi confirmado.** Transação com `pg_sleep(7)` passou (7137ms) — com
o padrão de 5s teria falhado. E a correlação em produção era exata: toda
falha vinha após alguns minutos de ociosidade; toda tentativa imediata
seguinte dava certo.

**Duas hipóteses erradas no caminho, que valem registro.** Primeiro achei
que a conexão ociosa *morria* e a consulta seguinte falhava — testei 7min
ociosos e ambas as conexões (direta e pooler) sobreviveram, refutando.
Depois achei que era só o limite de 5s — testei localmente e a transação
fria levou 1307ms, bem abaixo, refutando de novo. As duas estavam certas
**em conjunto**, e nenhuma reproduzia daqui porque a latência local até o
Neon é bem menor que a do Railway. A lição: para erro que só acontece em
produção, buscar o log de produção antes de teorizar — foi o log que
resolveu em um minuto o que duas rodadas de teste não resolveram.

**Alternativa considerada.** Trocar a `DATABASE_URL` para o endpoint com
pooler do Neon (`-pooler`, com `pgbouncer=true`) deixaria a reconexão mais
barata. Testado e funciona, inclusive com as transações interativas que a
criação de pedido usa. Ficou de fora por ora porque exige mexer em
variável de ambiente em produção e o ajuste de limite já resolve a causa
imediata — mas continua sendo a evolução natural se o problema voltar.

---

## 2026-08-14 — Pagamento por PIX (Mercado Pago): Orders API, não Payments API

**O que mudou.** `POST /orders` com PIX agora gera cobrança de verdade no
Mercado Pago e devolve QR Code + copia-e-cola na resposta. `POST
/payments/webhook` recebe a confirmação e avança o pedido sozinho
(`PENDING_PAYMENT` → `CONFIRMED`). Se o Mercado Pago falhar ou o PIX for
recusado/expirar, o pedido é cancelado automaticamente em vez de ficar
preso para sempre.

**Por que Orders API (`/v1/orders`) e não Payments API (`/v1/payments`).**
A implementação original usava a Payments API, a mais documentada e a que
a maioria dos exemplos por aí usa. Ela **não funcionou nesta conta**: toda
tentativa de criar um PIX — mesmo com credencial de teste genuína e um
comprador de teste real criado pela própria API do Mercado Pago — voltava
`401 "Unauthorized use of live credentials"`. Isolado numa chamada crua
via `fetch`, sem nenhum código nosso no meio, o erro persistiu, descartando
bug de implementação. A Orders API, com a mesma credencial, funcionou de
primeira. Conclusão: a aplicação criada no painel do Mercado Pago não tem
a Payments API habilitada, só a mais nova. Ver o histórico de testes desta
sessão se a causa raiz precisar ser revisitada.

**`date_of_expiration` no envio dá 400.** A Orders API recusa esse campo
dentro de `transactions.payments[0]` com
`"additionalProperties 'date_of_expiration' not allowed"` — contra-intuitivo,
já que é exatamente o nome do campo que a resposta devolve. No **envio** o
campo certo é `expiration_time`, em duração ISO 8601 (`"PT30M"`, não uma
data absoluta). A resposta da API já traz `date_of_expiration` calculado
(esse sim, é o que o resto do código le).

**`payer.email` é obrigatório para PIX.** `orderCustomerSchema` (em
`@adventure/shared`) ganhou um campo `email` opcional, exigido só quando
`isOnlinePayment(paymentMethod)` — checkout de dinheiro/cartão na entrega
continua sem pedir e-mail.

**`PaymentsModule` não importa `OrdersModule`.** Pedido cria pagamento e
pagamento confirma pedido formam um ciclo natural entre os dois módulos.
Em vez de resolver com `forwardRef()`, `PaymentsService` le e escreve o
pouco que precisa de `Order` (status, número) direto pelo `PrismaService`
— que já é `@Global()` — mantendo a dependência entre módulos numa via só
(`Orders` → `Payments`).

**Testado de ponta a ponta antes do deploy**, com o SDK real e credenciais
de teste: criação de cobrança PIX real com QR Code, gravação do `Payment`
no banco, e — usando o gatilho de teste do próprio Mercado Pago
(`payer.first_name: "APRO"`, que aprova o pedido sozinho em sandbox
alguns segundos depois de criado) — o ciclo completo até
`PENDING_PAYMENT` → `CONFIRMED` via `handleNotification()`. Tudo criado
e apagado no banco de produção durante o teste (não há banco de
staging neste projeto).

**O que falta testar.** O webhook HTTP real do Mercado Pago batendo no
endpoint publicado (`/api/v1/payments/webhook`) com assinatura de
verdade — isso só é possível com a URL publicamente acessível, ou seja,
depois do deploy.

---

## 2026-08-13 — Adicionais do lanche: schema já existia, faltava expor e popular

**O que mudou.** Clicar em "Adicionar" no cardápio agora abre uma caixa com
os adicionais do lanche (Bacon +R$7, Ovo +R$4, Onions +R$11, Hambúrguer
+R$11, Picles +R$4), um campo de observações e o seletor de quantidade.

**Quase nada de backend foi escrito.** `OptionGroup`, `Option`,
`ProductOptionGroup`, `OrderItem.optionsPriceCents`, `OrderItemOption` e
`OrderItem.notes` já existiam no schema; `orderItemInputSchema` já aceitava
`optionIds` e `notes`; e `order-pricing.service.ts` já resolvia os
adicionais, somava o preço e **já validava** que cada opção pertence a um
grupo do próprio produto, respeitando min/maxSelect. Faltavam só duas
coisas: o catálogo não devolvia os grupos, e as tabelas estavam vazias.

**Adicionais vêm junto com o cardápio, não numa segunda requisição.** A
caixa abre a partir de um cartão já carregado; buscar "bacon, ovo, picles"
num `GET` separado atrasaria a abertura sem ganho — são poucas linhas por
produto.

**A caixa abre mesmo para produto sem nenhum adicional** (bebidas, por
exemplo). Ela deixou de ser "escolha os extras" e virou a única porta de
entrada do carrinho, porque o campo de observações vale para qualquer
item — é onde o cliente escreve "sem cebola".

**Linha do carrinho agora tem assinatura.** Antes duas unidades do mesmo
produto sempre se fundiam numa linha só. Com adicionais isso apagaria a
diferença entre "Classic com bacon" e "Classic sem bacon" — viraria
"Classic x2" e a cozinha erraria o pedido. A fusão agora exige mesmo
produto **e** mesmos adicionais **e** mesma observação (`assinatura()` em
`stores/cart.ts`).

**Carrinho salvo antes disso precisou de migração.** O `persist` do zustand
subiu para `version: 1` com um `migrate` que injeta `options: []` nos itens
antigos. Sem isso, quem tivesse item no carrinho abriria a loja e veria
tela branca — `options.map()` em `undefined` no primeiro `subtotalCents()`.

**Quais produtos recebem adicionais.** Burguers Clássicos, Burguers
Especiais e Combos (20 produtos). Porções e Bebidas ficaram de fora — ovo
em refrigerante não faz sentido. A lista está em
`CATEGORIAS_COM_ADICIONAIS`, no topo de `prisma/seed-adicionais.ts`, junto
com os preços; o script é idempotente e serve para reajustar valores
depois (`npm run db:seed-adicionais`).

**Preço continua sendo do servidor.** O que a caixa mostra é só exibição;
no fechamento o `price()` recalcula tudo lendo o banco. Verificado na
prática: mandar o id de um adicional de outro produto, um id inventado, ou
mais opções que o `maxSelect` — os três são recusados.

---

## 2026-08-13 — Cadastro de produto: slug gerado no servidor, sem endpoint novo de categorias

**O que mudou.** `POST /admin/products` cadastra um produto novo — antes só
existia edição (`PATCH`). No painel da loja (`loja.impactdev.site/admin`),
um botão "+ Novo produto" ao lado de "Ver loja" abre uma caixa com
categoria, nome, descrição, preço e disponibilidade.

**Sem campo de slug no formulário.** Ele é gerado no servidor a partir do
nome (`gerarSlugUnico` em `products-admin.service.ts`), removendo acentos
via `normalize('NFD')` + remoção da faixa Unicode das marcas combinantes
(U+0300 a U+036F). Colisão de nome ("Combo Especial" cadastrado duas vezes)
resolve sozinha com sufixo `-2`, `-3`... Pedir para a pessoa digitar um
slug só abriria espaço para caractere inválido ou duplicado — o mesmo
raciocínio de não editar o slug ao renomear um produto (ver `update()`,
comentário já existente no arquivo).

**Sem endpoint novo para listar categorias.** O formulário usa a mesma
lista que `GET /admin/products` já devolve (cada categoria já vem com
`id` e `name`) — criar `GET /admin/categories` só para preencher um
`<select>` seria estado duplicado sem necessidade.

**`storeId` vem do token, não de uma query no banco.** `@CurrentAdmin
('storeId')` lê direto do JWT (o payload já carrega o campo, usado em
outros pontos da auth) em vez de `prisma.store.findFirst()` como
`orders.service.ts` faz — aqui já se sabe qual loja é, então a query
extra não teria propósito.

**Posição do produto novo.** Entra no fim da própria categoria (maior
`position` da categoria + 1), não no fim da lista inteira — é onde a
pessoa que acabou de cadastrar espera encontrá-lo.

**Sem foto no cadastro.** O produto nasce sem imagem (cai no ícone padrão
do cardápio) e disponível por padrão; a foto se envia depois pelo mesmo
botão "Editar" que já existe. Enfiar upload de arquivo no mesmo modal do
cadastro deixaria o formulário mais complexo sem ganho — quem cadastra
um produto no capricho normalmente ainda não tem a foto em mãos.

---

## 2026-08-07 — A URL da foto é calculada na leitura, não guardada em coluna

**O que mudou.** O `imageUrl` que o cardápio devolve deixou de ser um campo
lido do banco e passou a ser montado a cada resposta, pelo
`ImageStorageService.resolveUrl()`. Com `PUBLIC_API_URL` configurada, ele
sai absoluto:
`https://api.impactdev.site/api/v1/catalog/products/{id}/image?v={versão}`.

**Por que não gravar a URL pronta.** Ela carrega o domínio da API, e
domínio muda — troca de provedor, ambiente de homologação, o próprio
`impactdev.site` um dia. Uma coluna com o domínio dentro fica errada em
todo ambiente que não seja aquele onde a linha foi escrita, e conserta-se
só com `UPDATE` em massa. O banco guarda a **origem** da foto (bytes ali
mesmo, ou caminho estático do seed); o endereço é decidido na leitura.

**Como a origem é decidida.** `imageMimeType` preenchido significa foto no
banco — vence sempre. Senão, cai no `imageUrl` do seed. Senão, `null`, e o
cartão do cardápio mostra o ícone padrão. Essa ordem existe por um motivo
concreto: rodar o seed de novo reescreve `imageUrl` com o caminho
estático, e sem a precedência do `imageMimeType` isso apagaria a foto que
alguém tinha acabado de enviar pelo painel.

**Por que absoluta, e não relativa.** A loja até resolvia o caminho
relativo sozinha, porque conhece `VITE_API_URL`. Mas isso é uma regra que
só existe dentro do storefront: qualquer outro consumidor — WhatsApp,
Mercado Pago, um app depois — receberia uma URL que não abre. A API passa
a devolver algo que funciona colado em qualquer lugar.

**`PUBLIC_API_URL` é opcional de propósito.** Vazia, a API volta a devolver
caminho relativo, que é o certo em desenvolvimento (o proxy do Vite põe
front e API na mesma origem) e evita que o deploy quebre por falta de uma
variável nova — depois do trabalho que deu subir esse serviço, hard-fail
em variável nova não valia o risco.

**Bônus achado no caminho.** O `getMenu()` usava `include` sem `select`,
então trazia a coluna `imageData` — os **bytes** de cada foto — em toda
listagem do cardápio. Enquanto as fotos eram arquivos da landing isso não
custava nada, porque a coluna estava vazia. Passaria a arrastar dezenas de
megabytes por requisição no instante em que as fotos entrassem no banco.
Agora todo `select` de produto é explícito.

**Migração das fotos do seed.** `prisma/importar-fotos-do-seed.ts` lê os
JPGs da landing e grava no banco. Idempotente (pula quem já tem foto no
banco) e obrigatoriamente **depois** do deploy da API nova — ver
`DEPLOY.md`, passo 4.

---

## 2026-08-06 — Build no Railway instala devDependencies explicitamente

**Sintoma.** Depois de resolver o `EBUSY`, o build avançou e quebrou em
`sh: 1: nest: not found` (exit code 127), na hora de compilar a API.

**Causa.** `NODE_ENV=production` é uma das variáveis do serviço no Railway,
e o Railway expõe as variáveis do serviço **também em tempo de build**.
Nesse modo o `npm ci` omite as `devDependencies`, e o `@nestjs/cli` — que
fornece o binário `nest` — só existe ali.

**Por que despistou.** `tsc` e `prisma` *sobreviveram* à instalação
enxuta, porque chegam como dependências transitivas de pacotes de
produção. Então o `@adventure/shared` compilou e o `prisma generate`
rodou normalmente; só o `nest` faltou. Parecia problema específico do
NestJS, não da instalação inteira.

**Como foi confirmado.** Rodando `NODE_ENV=production npm ci` numa cópia
limpa do repositório: 293 pacotes contra 759 do install completo, e os
mesmos "62 packages looking for funding" que o log do Railway mostrava.
Em `node_modules/.bin` havia `tsc` e `prisma`, mas não `nest`.

**Primeira tentativa, que não funcionou.** `nixpacks.toml` com
`[phases.install] cmds = ['npm ci --include=dev']`. Preferimos isso a
mexer no painel porque ficaria versionado, mas o Railway simplesmente
**ignorou** essa configuração — o próximo build falhou do mesmo jeito, e
a própria caixa de resumo do Nixpacks no log continuou mostrando
`install │ npm ci`, sem o `--include=dev`. Não foi possível confirmar a
causa exata (suspeita: o `build.buildCommand` já definido no
`railway.json` faz o Railway gerar o plano de build por conta própria e
esse plano não é mesclado com um `nixpacks.toml` solto), mas o fato
observado é que o override de fase não pegou.

**Também descartado.** Mover `@nestjs/cli` para `dependencies` no
`apps/api/package.json`. Resolvia o `nest: not found`, mas só esse — o
`nest build` roda o TypeScript por baixo, e sem as outras
`devDependencies` (`typescript`, `@types/express`, etc.) o build quebra
de novo, agora com erro de tipos. Teria que mover a lista inteira de
devDependencies de build, o que não faz sentido semântico nenhum.

**Decisão final.** Variável de ambiente `NPM_CONFIG_INCLUDE=dev`,
cadastrada no Railway (**Variables**, junto dos segredos — não é segredo,
mas é *build-time*, então precisa estar lá, não só no `.env.production`).
É uma env var padrão do próprio `npm` (equivalente a `npm config set
include dev`), lida diretamente pelo `npm ci` independente de qualquer
particularidade do Nixpacks/Railway — por isso funciona onde o
`nixpacks.toml` não funcionou. Confirmado localmente: com
`NODE_ENV=production` e `NPM_CONFIG_INCLUDE=dev` juntos, `npm ci` puro
instala os 759 pacotes e o build completo passa.

**Custo aceito.** A imagem final carrega as devDependencies e fica maior.
Numa API deste porte isso não pesa, e evita a complexidade de um build
multi-estágio.

**Quando revisar.** Se o Railway passar a respeitar `nixpacks.toml`
mesmo com `build.buildCommand` definido, dá para voltar a versionar isso
em vez de depender do painel — vale testar de novo numa próxima mudança
de infra.

---

## 2026-08-04 — `nixpacks.toml` desliga o cache de `node_modules/.cache`

**Sintoma.** Build no Railway falhava sempre no mesmo passo, com
`npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'`
(exit code 240).

**Primeira hipótese, incompleta.** Achamos que era `npm ci` duplicado —
o `railway.json` chamava `npm ci &&` no início do `buildCommand`, e o
Nixpacks já roda `npm ci` sozinho na fase de instalação (detecta o
`package-lock.json` automaticamente). Tirar o `npm ci` redundante do
`buildCommand` era correto (evita rodar a instalação duas vezes à toa),
mas não resolveu: o erro persistiu identico mesmo com um único `npm ci`.

**Causa real.** `node_modules/.cache` é um diretório cacheado por padrão
na **fase de build** do Nixpacks (não na de instalação). Como a fase de
instalação e a de build acabam compiladas numa única camada Docker (um só
`RUN npm ci && npm run build ...`), o cache mount da fase de build já está
montado quando o `npm ci` da fase de instalação tenta limpar esse mesmo
diretório — e falha com `EBUSY` porque o diretório está ocupado pelo mount.

**Decisão.** `nixpacks.toml` na raiz, desligando só esse cache específico:

```toml
[phases.build]
cacheDirectories = []
```

Não usamos a variável de ambiente `NO_CACHE=1` (também documentada pelo
Railway para esse erro) porque ela desliga *todo* o cache do build
(incluindo pacotes Nix e registry do npm), deixando cada build bem mais
lento. Desligar só `node_modules/.cache` resolve o conflito e mantém os
outros caches.

**Quando revisar.** Se o Nixpacks mudar o comportamento de merge de fases,
ou se algum passo do build passar a depender de persistir algo em
`node_modules/.cache` entre builds (nenhum dos scripts atuais depende
disso).

---

## 2026-08-04 — Fotos de produto guardadas no próprio Postgres

O painel de cardápio (dentro da loja, em `/admin`) permite trocar a foto de
qualquer produto. Isso exigiu decidir onde o arquivo enviado passa a morar.

**Decisão.** Guardar os bytes na própria tabela `product`
(`imageData` + `imageMimeType`), servindo por
`GET /catalog/products/:id/image`.

**Por que não S3 / Cloudflare R2 agora.** É a resposta "certa" em escala, mas
exigiria criar conta, gerar credenciais e configurá-las antes de qualquer
linha funcionar. Para ~30 produtos, com foto trocada raramente e limite de
3 MB por arquivo, o custo dessa dependência não se paga hoje.

**Por que é seguro nesta escala.** 30 produtos × 3 MB no pior caso = 90 MB,
contra 512 MB do plano gratuito do Neon. Na prática as fotos ficam bem abaixo
disso.

**O que protege o futuro.** Todo acesso passa pelo `ImageStorageService`.
Migrar para R2 significa reescrever **apenas essa classe** — controller,
frontend e schema de URL pública continuam iguais.

**Cache.** A URL carrega a versão da foto (`?v=N`, incrementada a cada
upload), então o `Cache-Control: immutable` de 1 ano é seguro: trocar a
imagem gera URL nova e nenhum navegador fica preso na antiga.

**Quando revisar.** Se o cardápio passar de ~200 produtos, se as fotos
começarem a ser trocadas com frequência, ou se o banco se aproximar do
limite do plano.

---

## 2026-08-02 — Relatórios consultam `order` direto, não as tabelas de rollup

O schema tem `daily_sales_rollup` e `product_sales_rollup`, criadas justamente
para o dashboard não varrer a tabela de pedidos. Mas elas ainda estão **vazias**:
alimentá-las exige job agendado, fila e reprocessamento histórico.

**Decisão.** Os endpoints de relatório consultam `order` e `order_item`
diretamente, com os índices que já existem (`order(storeId, createdAt)` e
`order(storeId, status, createdAt)`).

**Por que é aceitável agora.** Com o volume de uma hamburguaria, alguns milhares
de pedidos por ano, a consulta agregada roda em milissegundos. Otimizar antes de
existir o problema custaria complexidade sem retorno.

**O que protege o futuro.** O formato da resposta dos endpoints foi desenhado
para ser idêntico ao que as rollups produzirão. Trocar a fonte de dados depois
é mudança interna do serviço, e nenhum frontend precisa ser alterado.

**Quando revisar.** Quando o dashboard passar de ~300 ms, ou ao ultrapassar
mais ou menos 50 mil pedidos. Aí entra o job de rollup.

---

## 2026-08-02 — Documentação da API sem `@nestjs/swagger` (por enquanto)

**Contexto.** `@nestjs/swagger@11.4.6` fixa `js-yaml` na versão exata `5.2.1`,
afetada por uma falha de negação de serviço (parsing exponencial em *flow
collections*, faixa `>=5.0.0 <=5.2.1`, gravidade alta).

**Tentativas de contornar, todas sem sucesso:**

1. `npm audit fix` — não resolve, o upstream não publicou correção.
2. Override com seletor de versão (`"js-yaml@5": "^5.2.3"`) — ignorado pelo npm.
3. Override aninhado sob `@nestjs/swagger` — ignorado, porque a dependência
   está fixada em versão exata e não em faixa.
4. Override global de `js-yaml` — também ignorado para a cópia aninhada, e
   ainda arrastaria o `js-yaml@4.3.1` usado pelo ESLint para a linha 5.x,
   com risco de quebra.

**Decisão.** Remover `@nestjs/swagger` das dependências.

**Por que o custo é baixo agora.** Estamos na Fase 0: não existe nenhum
endpoint para documentar. Adiar não bloqueia nada.

**Quando revisar.** Assim que `@nestjs/swagger` publicar versão com
`js-yaml >= 5.2.3`. Verificar com:

```bash
npm view @nestjs/swagger dependencies.js-yaml
```

**Alternativa, se o upstream demorar.** `@scalar/nestjs-api-reference`, que
gera a mesma referência OpenAPI sem depender de `js-yaml`.

**Nota de risco.** O risco prático da falha neste projeto seria baixo — o
Swagger apenas serializa a especificação, nunca interpreta YAML enviado por
usuário. Ainda assim, manter `npm audit` limpo é o que permite notar
imediatamente uma vulnerabilidade nova e de verdade. Ruído constante em
auditoria é como se perde a que importa.

---

## 2026-08-02 — Vitest 4 em vez de 2

`vitest@2` arrastava `vite@5`, com 5 vulnerabilidades, uma delas crítica
(leitura e execução arbitrária de arquivos quando o servidor de UI está
ativo). Atualizar para `vitest@4` zerou todas.

---

## 2026-08-02 — Valores monetários em centavos inteiros

Todo valor monetário é `Int` em centavos, nunca `Float`/`Decimal` em reais.

Motivo: `0.1 + 0.2 === 0.30000000000000004` em ponto flutuante. Num pedido
com vários itens e adicionais, o erro se acumula e o total cobrado diverge do
exibido — o tipo de bug que gera estorno e desgaste com o cliente.

Ver `packages/shared/src/money.ts` e seus testes.

---

## 2026-08-02 — O cliente nunca envia preço

`createOrderSchema` aceita apenas *o que* foi pedido (produto, quantidade,
adicionais). O servidor calcula *quanto custa* consultando o banco.

Motivo: aceitar preço vindo do navegador permite alterar o total no DevTools.
É a fraude mais comum em e-commerce.

---

## 2026-08-02 — Landing preservada, sem build

A landing continua em HTML/CSS/JS puro, sem framework nem etapa de compilação,
e está no `.prettierignore`.

Motivo: o CSS foi ajustado à mão, com espaçamento e agrupamento próprios.
Formatação automática reescreveria os arquivos inteiros, poluindo as revisões
e descartando esse trabalho. A integração com o sistema acontece pela troca da
constante `LINK_PEDIDO`, sem tocar no visual.
