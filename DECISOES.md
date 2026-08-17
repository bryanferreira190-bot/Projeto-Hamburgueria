# Registro de decisões técnicas

Decisões que não são óbvias pelo código, com o motivo por trás.
Formato: mais recente no topo.

---

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
