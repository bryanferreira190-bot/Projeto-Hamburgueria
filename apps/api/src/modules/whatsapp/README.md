# Integração WhatsApp Cloud API (Meta)

Envio de mensagens automáticas pela API **oficial** da Meta.

> **Não usamos Baileys, Venom ou similares.** Bibliotecas não oficiais
> violam os termos do WhatsApp e levam a **banimento do número
> comercial** — o mesmo número que a loja usa para atender cliente.

---

## Estado atual

A integração está **pronta e desligada**. Com `WHATSAPP_ENABLED=false`
(o padrão), nenhuma chamada sai para a Meta: o sistema registra no log
exatamente o que enviaria e devolve sucesso *simulado*, para o resto
continuar funcionando.

**Para ligar, basta preencher variáveis de ambiente. Nenhuma linha de
código muda.**

---

## Como ligar (passo a passo)

### 1. Conta e número

1. Crie/entre em uma conta **Meta Business** verificada
   (business.facebook.com).
2. Em **WhatsApp Manager**, adicione o número que será da loja.
   ⚠️ O número **não pode estar ativo** no app WhatsApp comum nem no
   WhatsApp Business. Use um chip novo ou migre o atual (perdendo o app
   nele).
3. Confirme o número por SMS/ligação.

### 2. Credenciais

No painel de desenvolvedores (developers.facebook.com), no seu app:

| O que pegar | Onde | Vira a variável |
|---|---|---|
| Token **permanente** de System User | Meta Business → Configurações → Usuários do sistema → Gerar token | `WHATSAPP_ACCESS_TOKEN` |
| ID do número | WhatsApp Manager → Números → "ID do número de telefone" | `WHATSAPP_PHONE_NUMBER_ID` |
| ID da conta WhatsApp Business | WhatsApp Manager → Configurações | `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| App Secret | App → Configurações → Básico → Chave Secreta | `WHATSAPP_APP_SECRET` |

O token do System User precisa das permissões
`whatsapp_business_messaging` e `whatsapp_business_management`.

> **Nunca use o token temporário de 24h** que aparece na tela de
> introdução — ele expira e derruba os envios sem aviso.

### 3. Templates

Toda mensagem **iniciada pela loja** exige template aprovado. Texto
livre só funciona nas 24h seguintes a uma mensagem *do cliente*.

> ### ⚠️ Aprove só um template agora
>
> **Hoje, o único template que o sistema realmente dispara é
> `cashback_expirando`** (pelo job diário das 10h). Os outros seis já têm
> o método de envio pronto no `WhatsAppService`, mas **nenhum ponto do
> código os chama ainda** — só serão acionados quando o fluxo de pedido
> for integrado.
>
> Aprovar os seis agora seria esperar dias pela Meta por mensagens que
> não vão sair. `GET /whatsapp/status` devolve o campo
> `precisaAprovarAgora` justamente com essa lista.

Registre em **WhatsApp Manager → Modelos de mensagem**, com o **nome
exato** e o **número de variáveis** da tabela abaixo. A fonte da verdade
é `whatsapp.templates.ts` — se divergir, a mensagem é recusada.

| Nome | Categoria | Vars | Em uso? | Texto a submeter |
|---|---|---|---|---|
| `cashback_expirando` | **MARKETING** | 2 | ✅ **sim** | Oi {{1}}! Seu cashback de {{2}} na Adventure Burguer expira amanhã. Aproveite! 🍔 |
| `pedido_recebido` | UTILITY | 3 | ainda não | Oi {{1}}! Recebemos seu pedido {{2}} no valor de {{3}}. Já vamos preparar! 🍔 |
| `pagamento_aprovado` | UTILITY | 2 | ainda não | Boa, {{1}}! O pagamento do pedido {{2}} foi aprovado. Já entrou na fila da cozinha. |
| `pagamento_recusado` | UTILITY | 2 | ainda não | Oi {{1}}, o pagamento do pedido {{2}} não foi aprovado. Tente outro cartão ou pague com PIX. |
| `pedido_em_preparo` | UTILITY | 2 | ainda não | {{1}}, seu pedido {{2}} entrou na chapa agora! 👨‍🍳 |
| `pedido_saiu_entrega` | UTILITY | 2 | ainda não | {{1}}, seu pedido {{2}} saiu para entrega! 🛵 Já já chega aí. |
| `pedido_entregue` | UTILITY | 2 | ainda não | {{1}}, seu pedido {{2}} foi entregue. Bom apetite! 🍔 |

Idioma: **Português (BR)** — `pt_BR`.

> **Por que `cashback_expirando` é MARKETING:** não trata de um pedido em
> andamento, e sim de trazer o cliente de volta. Classificar como UTILITY
> seria contornar a regra da Meta e arriscar reprovação. Marketing custa
> mais por conversa e exige opt-in.

### 4. Webhook (opcional, mas recomendado)

Serve para saber se a mensagem foi entregue, lida ou falhou.

1. No app → WhatsApp → Configuração, aponte para
   `https://api.impactdev.site/api/v1/whatsapp/webhook`
2. Em "Token de verificação", coloque um valor à sua escolha e replique
   em `WHATSAPP_VERIFY_TOKEN`.
3. Assine os campos `messages`.

### 5. Ligar

No Railway → Variables:

```
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=...
```

`WHATSAPP_API_VERSION` já vem como `v23.0`; só mexa quando a Meta
descontinuar a versão.

---

## Como testar

Duas rotas administrativas (exigem papel **OWNER**):

```
GET  /api/v1/whatsapp/status   → mostra se está ativo e lista os templates
POST /api/v1/whatsapp/teste    → dispara uma mensagem
```

Corpo do teste, por template:

```json
{ "phone": "11970706978", "template": "PAGAMENTO_APROVADO", "variaveis": ["João", "A012"] }
```

Ou texto livre (só dentro da janela de 24h):

```json
{ "phone": "11970706978", "texto": "teste" }
```

Com `WHATSAPP_ENABLED=false` a resposta vem com `"simulado": true` e
nada é enviado — útil para conferir o payload montado antes de ligar.

---

## Estrutura

| Arquivo | Responsabilidade |
|---|---|
| `whatsapp.service.ts` | Regras de envio e métodos de negócio (`sendOrderReceived`, etc.) |
| `meta-graph.client.ts` | HTTP puro: URL versionada, auth, timeout, retry, tradução de erro |
| `whatsapp.errors.ts` | Classifica erro da Meta e decide se vale repetir |
| `whatsapp.templates.ts` | Catálogo — o contrato com a Meta |
| `whatsapp.types.ts` | Tipagens da Cloud API |
| `whatsapp-webhook.service.ts` | Verificação (`hub.challenge`), assinatura HMAC e processamento |
| `whatsapp.controller.ts` | Rotas de webhook e de diagnóstico |

O módulo é **desacoplado**: não importa `OrdersModule`, `CashbackModule`
nem `PrismaModule`, e não sabe o que é pedido ou cliente — recebe
telefone, texto e variáveis. Quem precisa avisar alguém importa este
módulo, nunca o contrário.

---

## Decisões que valem saber

**Retry só no que adianta repetir.** Limite de envio, timeout e 5xx são
transitórios: até 3 tentativas com backoff exponencial e *jitter* (sem o
jitter, envios que falharam juntos voltariam todos no mesmo instante e
bateriam no mesmo limite). Token inválido, número inexistente e template
reprovado **não** são repetidos — a resposta seria idêntica.

**Sucesso simulado é sinalizado.** `ResultadoDeEnvio.simulado` distingue
"a Meta aceitou" de "está desligado e só foi registrado". Quem grava
"aviso enviado" em algum lugar **precisa** checar esse campo — é
exatamente o que o job de cashback faz, para não marcar como avisado
alguém que nunca recebeu nada.

**Webhook recusa sem App Secret.** Sem `WHATSAPP_APP_SECRET` a
assinatura não pode ser conferida, e o webhook responde 401 a tudo.
Aceitar evento não verificado permitiria a qualquer um forjar "mensagem
entregue" — mesmo critério do webhook do Mercado Pago.

**Telefone é mascarado no log** (`*********6978`). Log é lido por mais
gente e guardado por mais tempo que o banco.

**Sem `@nestjs/config`.** O projeto centraliza ambiente no token `ENV`
(Zod, validado uma vez no boot, falha rápido). O `@nestjs/config` foi
removido na auditoria por não ter uso; reintroduzir daria dois caminhos
para a mesma coisa.
