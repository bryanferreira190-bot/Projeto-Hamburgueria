# Notificacoes automaticas de pedido (WhatsApp via Evolution API)

Manda mensagem de WhatsApp automaticamente quando um pedido muda de status
(recebido, pagamento aprovado, em preparo, saiu para entrega, entregue).
**Independente** do modulo `whatsapp/` (Meta Cloud API, oficial), que
continua no repositorio, dormente, pronto para ser ativado quando a
verificacao do WhatsApp Business Manager terminar. Ver "Relacao com o
modulo whatsapp/" no fim deste arquivo.

## Por que Evolution e nao Meta, aqui

O projeto documenta em `ARQUITETURA.md` a decisao de nao usar bibliotecas
nao-oficiais (Baileys/Venom), por risco de banimento do numero comercial.
A Evolution API descrita nesta integracao roda sobre Baileys. Isso foi
levantado explicitamente para o dono do projeto antes de qualquer linha de
codigo, com a decisao registrada em `DECISOES.md`: manter os dois caminhos
— Evolution ativo agora (funciona hoje, com o risco de banimento aceito
conscientemente), Meta pronto para assumir depois que a verificacao do
WhatsApp Business Manager terminar (troca e so mudar `WHATSAPP_PROVIDER`,
sem tocar em `OrdersService`/`PaymentsService`).

## Como ativar

Variaveis de ambiente (ver `.env.example` / `.env.production.example`):

| Variavel | Obrigatoria quando ativo | Descricao |
|---|---|---|
| `WHATSAPP_PROVIDER` | — | `none` (padrao, nunca manda nada) ou `evolution` |
| `EVOLUTION_API_URL` | sim | Base da Evolution, sem barra no final. Ex.: `https://minha-evolution.onrender.com` |
| `EVOLUTION_API_KEY` | sim | Chave enviada no header `apikey`. Segredo — nunca vai ao frontend |
| `EVOLUTION_INSTANCE` | sim | Nome da instancia ja conectada ao WhatsApp Business (ex.: `adventure-burguer`) |

Com `WHATSAPP_PROVIDER=evolution`, o boot falha cedo (fail-fast, mesmo
padrao do modulo `whatsapp/`) se qualquer uma das 3 variaveis acima
estiver faltando — nunca sobe metade configurado. Com `WHATSAPP_PROVIDER=none`
(padrao), nenhuma delas e exigida e nenhuma chamada de rede sai; todo
evento e logado como simulado.

## Eventos e templates

7 eventos. Os 6 primeiros sao mapeados aos status ja existentes de
`Order` (nenhum status novo foi criado); o 7º e disparado por um job
diario, nao por mudanca de status:

| Evento (`NotificationEvent`) | Disparado quando |
|---|---|
| `ORDER_RECEIVED` | Pedido criado ja como `CONFIRMED` (pagamento offline: dinheiro/cartao na entrega) |
| `PAYMENT_APPROVED` | Pedido sai de `PENDING_PAYMENT` para `CONFIRMED` (cartao online ou PIX aprovado, inclusive via webhook do Mercado Pago) |
| `PREPARING` | Pedido entra em `PREPARING` |
| `READY` | Pedido entra em `READY` (entrega e retirada) |
| `OUT_FOR_DELIVERY` | Pedido entra em `OUT_FOR_DELIVERY` |
| `DELIVERED` | Pedido entra em `DELIVERED` ou `COMPLETED` (cobre tanto entrega quanto retirada no balcao concluida) |
| `CASHBACK_REMINDER` | Uma vez por dia, as 11h (`America/Sao_Paulo`), para pedidos de ONTEM com cashback disponivel — ver `cashback-reminder.job.ts` |

`AWAITING_PICKUP` nao tem evento proprio: `READY` ja avisa que o
pedido esta pronto (para os dois tipos), e "ainda esperando" nao traz
informacao nova.

Cada evento tem um `NotificationTemplate` por loja (`storeId + event`),
com texto padrao ja cadastrado na primeira leitura/listagem. O admin edita
o texto e liga/desliga cada evento em `PUT /notifications/templates/:event`
— sem deploy. Placeholders aceitos, substituidos por texto puro (sem
regex):

| Placeholder | Valor |
|---|---|
| `{nome}` | Primeiro nome do cliente |
| `{pedido}` | Numero do pedido (ex.: `A001`) |
| `{valor}` | Total formatado em BRL (ex.: `R$ 30,00`) |
| `{status}` | Rotulo do status atual em portugues |
| `{telefone}` | Telefone do cliente formatado (ex.: `(11) 97070-6978`) |
| `{cashback}` | Saldo de cashback do cliente, ja em BRL (ex.: `R$ 12,50`, ou `R$ 0,00`) — consultado NA HORA do envio, nunca guardado |

## Lembrete diario de cashback (`CashbackReminderJob`)

Roda uma vez por dia (`@Cron('0 11 * * *', { timeZone: 'America/Sao_Paulo' })`)
e avisa quem fez pedido ontem (qualquer status exceto `CANCELED`) do
saldo de cashback disponivel. Escolhas deliberadas:

- **Cron, nao fila/Redis.** O projeto nao tem fila hoje (ver secao
  "Sem fila externa" acima) — mesmo padrao ja usado em
  `CashbackExpiryJob`/`ExpiredPixJob`. Sobrevive a redeploy/restart
  porque nao depende de nenhum timer em memoria: a cada execucao,
  consulta o banco por pedidos na janela `[ontem, hoje)`, entao um
  restart no meio do caminho so adia a proxima varredura, nunca perde o
  lembrete.
- **Idempotencia via `NotificationLog`**, a MESMA tabela e o MESMO
  criterio (`orderId + event + success`) dos outros 5 eventos — nenhuma
  coluna nova, nenhuma tabela nova.
- **Saldo zero: nunca manda mensagem**, nem grava log — o pedido so
  fica elegivel na janela de datas de HOJE; amanha a consulta ja olha
  para outro intervalo, entao nao ha risco de tentar para sempre nem de
  nunca mais tentar.
- **Saldo sempre consultado no momento do envio** (`CashbackService.saldoDoCliente`),
  nunca o valor de quando o pedido foi feito.

## Garantias

- **Pedido nunca depende de WhatsApp.** Todo disparo e fire-and-forget
  (`void promise.catch(...)`, nunca `await`ado por quem muda o status do
  pedido) — mesmo Evolution fora do ar, lenta para acordar (plano
  gratuito do Render hiberna) ou devolvendo erro, o pedido segue seu
  fluxo normal. `MessagingService.notificar()` nunca lanca excecao.
- **Idempotencia.** Antes de mandar, confere se ja existe um
  `NotificationLog` de sucesso para aquele `(orderId, event)`; se sim,
  pula. Falha anterior nao bloqueia nova tentativa. Isso e defesa a mais
  — as transicoes de status que disparam notificacao ja sao protegidas
  por compare-and-swap em `OrdersService`/`PaymentsService`.
- **Retry com backoff.** Ate 3 tentativas, backoff exponencial com
  jitter. Erros de credencial/instancia (`401`/`404`) nunca repetem;
  timeout, erro de conexao e `5xx` repetem.
- **Logs nunca expoem segredo ou telefone completo.** `EVOLUTION_API_KEY`
  nunca aparece em log; telefone e sempre mascarado
  (`*********6978`) via `whatsapp/whatsapp.utils.ts` (reaproveitado do
  modulo Meta — funcao pura, sem estado).
- **Sem fila externa.** Nao ha Redis/BullMQ no projeto hoje; o retry e
  feito em memoria, dentro da propria chamada assincrona. Se a Evolution
  cair pelas 3 tentativas, a notificacao daquele evento fica perdida
  (nao ha fila para retomar depois) — aceitavel porque isto e
  notificacao, nao o pedido em si.

## Testando manualmente

1. **Status da integracao** (sem mandar nada):
   `GET /notifications/status` (auth OWNER) — devolve `{ ativo, provider,
   conectado, detalhe }`.
2. **Envio de teste** (manda de verdade se `WHATSAPP_PROVIDER=evolution`):
   `POST /notifications/test` (auth OWNER, limite de 5 por minuto) com
   `{ "phone": "11970706978", "message": "teste" }`.
3. **Fluxo real**: criar um pedido com pagamento offline → deve chegar
   `ORDER_RECEIVED`. Avancar o status pelo admin (`PREPARING`, `READY`,
   `OUT_FOR_DELIVERY`, `DELIVERED`) → cada transicao dispara o evento
   correspondente. Aprovar um pagamento PIX/cartao pendente → dispara
   `PAYMENT_APPROVED`.
4. **Templates**: `GET /notifications/templates` lista os 7 (cria com
   texto padrao quem faltar); `PUT /notifications/templates/:event` com
   `{ "message": "...", "isActive": false }` edita ou desliga um evento.

## Relacao com o modulo `whatsapp/`

`apps/api/src/modules/whatsapp/` (Meta Cloud API oficial) continua
intocado, dormente (`WHATSAPP_ENABLED=false`). Os dois modulos:

- Nao compartilham cliente HTTP nem logica de retry (dois provedores
  genuinamente independentes por tras da mesma ideia — ver comentario no
  topo de `providers/evolution-whatsapp.provider.ts`).
- Reaproveitam so as funcoes puras de telefone
  (`paraFormatoInternacional`, `mascararTelefone`) de
  `whatsapp/whatsapp.utils.ts`.
- Tem tabelas separadas: `NotificationTemplate`/`NotificationLog` (este
  modulo) nao tem relacao com o catalogo de templates aprovados da Meta.

Quando a Meta Cloud API estiver pronta para produção, a troca e:
`WHATSAPP_PROVIDER=none` + `WHATSAPP_ENABLED=true` + credenciais da Meta.
Nenhum codigo de `OrdersService`/`PaymentsService` precisa mudar — os dois
so conhecem `MessagingService` (a camada abstrata), nunca um provedor
concreto diretamente.
