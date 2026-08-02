# Adventure Burguer — Arquitetura do Sistema de Pedidos

> Documento de definição técnica. Nenhum código foi escrito ainda.
> Última revisão: 02/08/2026

---

## 1. Visão geral

Sistema próprio de pedidos online (modelo iFood), composto por **três aplicações
independentes** que consomem **uma única API**:

| Aplicação | Papel | Quem acessa |
|---|---|---|
| **Landing** | Vitrine institucional (a atual, preservada) | Público |
| **Storefront** | Cardápio, carrinho, checkout, acompanhamento | Cliente |
| **Admin** | Dashboard, relatórios, gestão, KDS de cozinha | Equipe |
| **API** | Regras de negócio, dados, integrações | As três acima |

**Fluxo de entrada:** a landing continua sendo a porta de entrada.
O botão "Peça Online" passa a apontar para o Storefront, e um link discreto
no rodapé leva ao login do Admin.

---

## 2. Stack escolhida

Critérios: adoção de mercado, segurança, escalabilidade e tipagem ponta a ponta.

### Backend
| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime | **Node.js 22 LTS** | LTS, ecossistema maduro |
| Linguagem | **TypeScript** (strict) | Erros em tempo de compilação |
| Framework | **NestJS 11** | Arquitetura modular nativa, DI, guards/interceptors — atende "organize em módulos" |
| ORM | **Prisma 6** | Migrations versionadas, queries parametrizadas (anti SQL-injection) |
| Banco | **PostgreSQL 16** | ACID real — indispensável para pedido + pagamento |
| Cache/Fila | **Redis 7 + BullMQ** | Filas, rate limit, sessões, realtime multi-instância |
| Realtime | **Socket.IO** (+ adapter Redis) | Cozinha e cliente veem status ao vivo |
| Validação | **Zod** | Mesmo schema no back e no front — zero duplicação |
| Docs | **Swagger/OpenAPI** | Gerado automaticamente |

### Frontend
| Camada | Escolha |
|---|---|
| Landing | **Mantida como está** — HTML/CSS/JS puro, sem build |
| Storefront / Admin | **React 19 + TypeScript + Vite** |
| Estilo | **TailwindCSS** com as cores da landing como tokens |
| Componentes (admin) | **shadcn/ui** |
| Gráficos | **Recharts** |
| Estado servidor | **TanStack Query** |
| Estado carrinho | **Zustand** (+ persistência em localStorage) |
| Formulários | **React Hook Form + Zod** |

### Infraestrutura
| Item | Escolha |
|---|---|
| Monorepo | **npm workspaces + Turborepo** |
| Containers | **Docker Compose** (dev) |
| Imagens | **Cloudflare R2** (S3-compatível, sem taxa de egresso) |
| Logs | **Pino** |
| Erros | **Sentry** |
| CI/CD | **GitHub Actions** |

---

## 3. Estrutura de pastas

```
pjt-hamburgueria/
├── apps/
│   ├── landing/                  # site atual — INTACTO
│   │   ├── index.html
│   │   └── assets/{css,js,img,video}
│   │
│   ├── storefront/               # React — experiência de pedido
│   │   └── src/
│   │       ├── features/         # cardapio, carrinho, checkout, pedido, conta
│   │       ├── components/
│   │       ├── lib/              # api client, formatadores
│   │       └── stores/           # zustand
│   │
│   ├── admin/                    # React — gestão
│   │   └── src/
│   │       └── features/         # dashboard, relatorios, pedidos, produtos,
│   │                             # cupons, entrega, usuarios, configuracoes
│   │
│   └── api/                      # NestJS
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts           # importa o cardápio atual
│       └── src/
│           ├── modules/
│           │   ├── auth/         # cliente (OTP) + admin (senha + 2FA)
│           │   ├── customers/
│           │   ├── catalog/      # categorias, produtos, adicionais
│           │   ├── orders/
│           │   ├── payments/     # provider agnóstico
│           │   ├── coupons/
│           │   ├── delivery/     # zonas, taxa, tempo
│           │   ├── notifications/# whatsapp, e-mail
│           │   ├── reports/      # relatórios e dashboard
│           │   ├── store/        # horários, status aberto/fechado
│           │   └── realtime/     # gateway socket.io
│           ├── common/           # guards, filters, interceptors, decorators
│           ├── config/           # env tipado e validado
│           └── infra/            # prisma, redis, queues, storage
│
├── packages/
│   ├── shared/                   # tipos + schemas Zod + enums (fonte única)
│   ├── config/                   # eslint, tsconfig, prettier compartilhados
│   └── ui/                       # tokens de design extraídos da landing
│
├── docker/
│   └── docker-compose.yml        # postgres + redis
├── .github/workflows/
├── turbo.json
└── package.json
```

**Princípio anti-duplicação:** tipos, enums e schemas de validação vivem **apenas**
em `packages/shared`. API e frontends importam de lá. Uma mudança de regra
acontece em um único lugar.

---

## 4. Banco de dados

### Modelo (PostgreSQL)

**Loja e operação**
- `store` — dados, taxa base, pedido mínimo, status
- `business_hour` — grade semanal (substitui a tabela fixa do JS)
- `delivery_zone` — bairro/raio → taxa e tempo estimado

**Catálogo**
- `category` — ordem de exibição, ativa
- `product` — nome, descrição, preço, imagem, disponibilidade
- `option_group` — "Escolha o ponto da carne", min/max seleção
- `option` — item do grupo, com acréscimo de preço
- `product_option_group` — N:N produto ↔ grupo

**Clientes**
- `customer` — telefone (único), nome, e-mail opcional
- `customer_address` — CEP, rua, número, complemento, referência, geo
- `otp_code` — código, expiração, tentativas (hash, nunca em texto puro)

**Pedidos**
- `order` — número curto, status, tipo (entrega/retirada), valores, endereço *congelado*
- `order_item` — **preço copiado no momento do pedido**
- `order_item_option` — adicionais escolhidos
- `order_status_history` — auditoria de cada transição

**Pagamentos**
- `payment` — provedor, status, valor, id externo, idempotency key
- `payment_webhook_event` — log bruto para reprocessamento

**Admin e segurança**
- `admin_user` — e-mail, hash Argon2id, papel, segredo TOTP
- `refresh_token` — rotação, revogação, device fingerprint
- `audit_log` — quem fez o quê, quando, de qual IP

**Relatórios**
- `daily_sales_rollup`, `product_sales_rollup` — agregados pré-calculados

### Decisões críticas

1. **Preço congelado no pedido.** `order_item.unit_price` é uma cópia, nunca um
   join com `product`. Alterar o preço hoje não pode reescrever o histórico de ontem.
2. **Dinheiro em centavos** (`Int`), nunca `Float`. Elimina erro de arredondamento.
3. **Endereço copiado** para o pedido. Se o cliente editar o endereço depois,
   a entrega passada continua correta.
4. **Soft delete** em produtos — pedidos antigos precisam continuar legíveis.

---

## 5. API

REST versionada em `/api/v1`, respostas de erro no padrão RFC 7807.

### Público
```
GET  /catalog/categories          Cardápio completo (cacheado)
GET  /catalog/products/:slug
GET  /store/status                Aberto/fechado + horários
POST /delivery/quote              Taxa e tempo por CEP
```

### Cliente
```
POST /auth/customer/request-otp   Envia código por WhatsApp
POST /auth/customer/verify-otp    Retorna tokens
POST /orders                      Cria pedido (idempotente)
GET  /orders/:id                  Detalhe + status
GET  /me/orders                   Histórico
```

### Pagamento
```
POST /payments/:orderId/intent    Gera PIX ou preferência de cartão
POST /webhooks/mercadopago        Assinado e verificado
```

### Admin (autenticado + RBAC)
```
POST /auth/admin/login            Senha + TOTP
GET  /admin/orders                Filtros, paginação
PATCH /admin/orders/:id/status
CRUD /admin/products | categories | coupons | delivery-zones
GET  /admin/dashboard             KPIs do período
GET  /admin/reports/sales         Série temporal
GET  /admin/reports/top-products
GET  /admin/reports/export        CSV / XLSX
```

### Realtime (Socket.IO)
- `order:created` → cozinha
- `order:status` → cliente e cozinha

---

## 6. Autenticação

**Dois domínios separados, propositalmente.** Cliente e administrador nunca
compartilham tabela, token ou sessão.

### Cliente — telefone + OTP
Sem senha para lembrar; o telefone já é necessário para a entrega.
Código de 6 dígitos com validade de 5 min, **guardado com hash**, máximo de
5 tentativas, rate limit por telefone e por IP.

### Admin — senha + 2FA
- Hash **Argon2id** (padrão atual recomendado, superior a bcrypt)
- **TOTP obrigatório** para papéis OWNER e MANAGER
- Bloqueio progressivo após tentativas falhas

### Tokens
| Token | Validade | Onde fica |
|---|---|---|
| Access | 15 min | memória (nunca em localStorage) |
| Refresh | 7 dias | cookie `httpOnly` + `Secure` + `SameSite=Strict` |

Refresh com **rotação e detecção de reuso**: se um token já usado reaparece,
toda a família é revogada (indica roubo de token).

### Papéis (RBAC)
`OWNER` · `MANAGER` · `KITCHEN` · `DELIVERY` — aplicados por guard no NestJS.

---

## 7. Painel administrativo

### Dashboard
KPIs do período (faturamento, pedidos, ticket médio, taxa de cancelamento) com
comparativo contra o período anterior, e os gráficos:
- **Faturamento por dia** (linha/área)
- **Produtos mais vendidos** (barras horizontais)
- **Vendas por hora** (mapa de calor) — apoia decisão de escala de equipe
- **Formas de pagamento** (rosca)

### Relatórios
Vendas por período, por produto, por categoria, por bairro, cupons utilizados,
com exportação CSV/XLSX.

### Operação
- **KDS** — painel de cozinha em tempo real, com som ao chegar pedido
- Gestão de cardápio, adicionais, cupons, zonas de entrega
- Botão de pausa emergencial ("parar de aceitar pedidos")

**Performance:** os gráficos leem das tabelas `*_rollup`, atualizadas por job.
Consultar `order` diretamente não escala depois de alguns meses de operação.

---

## 8. Pagamentos

**Provedor: Mercado Pago** — padrão de mercado no Brasil, PIX nativo,
cartão, e webhooks confiáveis.

Implementado atrás de uma **interface `PaymentProvider`** (padrão Strategy).
Trocar para Stripe, Asaas ou Pagar.me depois não toca no módulo de pedidos.

### Segurança
- **Nenhum dado de cartão passa pelo nosso servidor** — tokenização no cliente
  via Checkout Bricks. Reduz drasticamente o escopo PCI-DSS.
- Webhook com **verificação de assinatura HMAC** obrigatória.
- **Idempotency key** na criação de pagamento — evita cobrança duplicada.
- **O valor é sempre recalculado no servidor.** O preço enviado pelo cliente é
  ignorado. Esta é a defesa contra a fraude mais comum em e-commerce.
- Confirmação apenas via webhook, nunca pelo retorno do navegador.

### Formas aceitas
PIX (com QR Code), cartão de crédito/débito online, e pagamento na entrega
(dinheiro com troco / maquininha).

---

## 9. WhatsApp

Implementado atrás de uma **interface `NotificationChannel`**, com duas fases:

**Fase 1 — `wa.me` (custo zero, sem aprovação)**
Ao confirmar o pedido, abre o WhatsApp com a mensagem pronta. Funciona
imediatamente e já é melhor que o fluxo atual.

**Fase 2 — WhatsApp Cloud API (oficial, Meta)**
Mensagens automáticas de mudança de status, sem intervenção humana.
Exige conta Meta Business verificada e templates aprovados.
Enviadas por **fila (BullMQ) com retry** — uma falha da Meta nunca pode
derrubar a criação do pedido.

> Não usaremos bibliotecas não oficiais (Baileys, Venom): violam os termos
> do WhatsApp e levam a banimento do número comercial.

---

## 10. Sistema de pedidos

### Máquina de estados
```
PENDING_PAYMENT ──> CONFIRMED ──> PREPARING ──> READY ──┬─> OUT_FOR_DELIVERY ──> DELIVERED
       │                 │                              └─> AWAITING_PICKUP ────> COMPLETED
       └──> CANCELED <───┘
```
Transições válidas ficam em uma tabela de regras, não espalhadas em `if`.
Toda transição grava em `order_status_history`.

### Criação (transacional)
1. Valida carrinho contra o banco (**preços do servidor**)
2. Verifica loja aberta e disponibilidade dos itens
3. Calcula taxa pela zona de entrega
4. Aplica cupom (validando regras e limite de uso)
5. Grava pedido + itens **em uma transação**
6. Enfileira notificações e emite evento de realtime

**Idempotência:** o cliente envia um `Idempotency-Key`. Dois cliques no botão
"Finalizar" geram um único pedido.

---

## 11. Escalabilidade

| Estratégia | Aplicação |
|---|---|
| API **stateless** | Escala horizontal atrás de load balancer |
| Cache Redis no cardápio | Rota mais acessada, invalidada na edição |
| Rollups pré-calculados | Dashboard não varre a tabela de pedidos |
| Filas assíncronas | WhatsApp/e-mail fora do caminho crítico |
| Índices dirigidos | `order(created_at)`, `order(status)`, `order(customer_id)` |
| Paginação por cursor | Listagens grandes sem `OFFSET` lento |
| CDN nas imagens | Landing e produtos servidos da borda |
| Modelagem multi-loja | `store_id` já presente desde o início |

---

## 12. Segurança

**Aplicação**
- Helmet (CSP, HSTS, X-Frame-Options)
- CORS por allowlist explícita
- Rate limiting global + reforçado em login, OTP e criação de pedido
- Validação Zod em toda entrada
- Prisma com queries parametrizadas
- CSRF (double-submit) nas rotas com cookie

**Dados**
- Argon2id nas senhas; OTP em hash
- Segredos só em variáveis de ambiente; `.env` fora do Git
- TLS obrigatório; backup diário com teste de restauração
- `audit_log` em toda ação administrativa

**LGPD**
- Coleta mínima; consentimento explícito
- Endpoints de exportação e exclusão de dados
- Política de retenção definida

**Regra de ouro:** nenhum valor financeiro vindo do cliente é confiável.
Preço, taxa, desconto e total são **sempre** recalculados no servidor.

---

## 13. Roadmap sugerido

| Fase | Entrega |
|---|---|
| **0** | Monorepo, Docker, Prisma, CI, landing preservada |
| **1** | Catálogo + seed do cardápio atual + API pública |
| **2** | Storefront: cardápio, carrinho, checkout |
| **3** | Auth cliente (OTP) + criação de pedido + WhatsApp fase 1 |
| **4** | Auth admin + 2FA + gestão de pedidos + KDS realtime |
| **5** | Pagamentos (PIX + cartão) + webhooks |
| **6** | Dashboard + relatórios + exportação |
| **7** | WhatsApp oficial, cupons, zonas, hardening, deploy |

---

## 14. Pendências que dependem de você

| Item | Necessário |
|---|---|
| Mercado Pago | Conta + credenciais de teste |
| WhatsApp Cloud API (fase 2) | Meta Business verificada |
| Cloudflare R2 | Conta (tem plano gratuito) |
| Hospedagem | Definir alvo (Railway, Fly.io ou VPS) |
| Docker Desktop | Não instalado nesta máquina |
