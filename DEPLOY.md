# Colocando o Adventure Burguer no ar

Guia passo a passo para publicar o projeto fora da sua máquina, usando o
domínio `impactdev.site`. Siga na ordem — cada etapa depende da anterior.

**Estrutura final:**
```
impactdev.site           → Landing
loja.impactdev.site       → Storefront (pedidos)
painel.impactdev.site     → Admin (dashboard/KDS)
api.impactdev.site        → API
```

---

## 0. Antes de começar

- [ ] Ter acesso ao painel do registrador onde comprou `impactdev.site`
      (Registro.br, GoDaddy, Namecheap, etc.) — vai precisar trocar os
      *nameservers* lá.
- [ ] Conta no GitHub com este repositório (já existe:
      `bryanferreira190-bot/Projeto-Hamburgueria`)

---

## 1. Mover o DNS para a Cloudflare (grátis)

1. Crie uma conta em [cloudflare.com](https://dash.cloudflare.com/sign-up)
2. **Add a site** → digite `impactdev.site` → plano **Free**
3. A Cloudflare vai escanear os registros DNS atuais e mostrar **dois
   nameservers** (algo como `ana.ns.cloudflare.com` e `bob.ns.cloudflare.com`)
4. Vá até o painel do **registrador** onde comprou o domínio, ache a opção
   "Nameservers" ou "DNS" e troque pelos dois que a Cloudflare deu
5. Volte na Cloudflare e clique em **Done, check nameservers**

> A propagação pode levar de alguns minutos a ~24h. A Cloudflare avisa por
> e-mail quando o domínio está ativo por lá.

---

## 2. Publicar a API no Railway

1. Crie uma conta em [railway.app](https://railway.app) (dá para entrar
   direto com o GitHub)
2. **New Project** → **Deploy from GitHub repo** → selecione
   `Projeto-Hamburgueria`
3. O Railway vai detectar o `railway.json` na raiz automaticamente
   (build e start command já configurados)
4. Vá em **Variables** e cole cada linha de
   [`apps/api/.env.production.example`](apps/api/.env.production.example)
   **com valor real**:
   - `DATABASE_URL` → a mesma connection string do Neon que já está em uso
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` → gere os
     três de uma vez rodando **no seu terminal** (não aqui no chat):
     ```
     node -e "const c=require('crypto');const g=()=>c.randomBytes(48).toString('base64url');for(const k of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','ENCRYPTION_KEY'])console.log(k+'='+g())"
     ```
     Saem as três linhas já no formato `CHAVE=valor`, prontas para colar de
     uma vez no **Raw Editor** do Railway (Variables → ⋮ → Raw Editor).
     Cada valor tem 64 caracteres, bem acima do mínimo de 32, e os três
     saem diferentes entre si — que é o que o `loadEnv()` exige.
   - `CORS_ORIGINS=https://impactdev.site,https://loja.impactdev.site,https://painel.impactdev.site`
   - Resto: copie os valores fixos do arquivo de exemplo
5. Em **Settings → Networking**, clique **Generate Domain** temporariamente
   para testar (ex.: `algo.up.railway.app`) — depois trocamos pelo domínio
   final
6. Aguarde o deploy. No final dos logs deve aparecer:
   `[Bootstrap] API no ar em http://localhost:3333/api/v1`
7. Teste: `https://algo.up.railway.app/api/v1/health` deve devolver
   `{"status":"ok",...}`

### Apontar o subdomínio

8. No Railway: **Settings → Networking → Custom Domain** → digite
   `api.impactdev.site`. Ele mostra um registro `CNAME` para criar.
9. Na Cloudflare: **DNS** → **Add record** → tipo `CNAME`, nome `api`,
   destino o valor que o Railway deu, proxy **desligado** (nuvem cinza,
   não laranja — a laranja pode interferir no WebSocket/streaming da API)

---

## 3. Publicar Landing, Storefront e Admin no Cloudflare Pages

Repita estes passos **três vezes**, uma por app. É a mesma tela, muda só o
"Root directory" e o "Build output directory".

1. Na Cloudflare: **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → autorize e escolha `Projeto-Hamburgueria`

| Campo | Landing | Storefront | Admin |
|---|---|---|---|
| **Nome do projeto** | `adventure-landing` | `adventure-loja` | `adventure-painel` |
| **Root directory** | `apps/landing` | `apps/storefront` | `apps/admin` |
| **Build command** | *(deixe em branco)* | `cd ../.. && npm ci --include=dev && npm run build --workspace=@adventure/shared && npm run build --workspace=@adventure/storefront` | `cd ../.. && npm ci --include=dev && npm run build --workspace=@adventure/shared && npm run build --workspace=@adventure/admin` |
| **Build output directory** | `.` | `dist` | `dist` |

> A landing não precisa de build (é HTML puro) — só aponte a raiz e o
> Cloudflare serve os arquivos como estão.
>
> Storefront e admin já têm `.env.production` versionado com a URL da API,
> então **não precisa configurar nenhuma variável de ambiente** nesses dois
> projetos.
>
> `--include=dev` é necessário porque o Cloudflare Pages roda o build com
> `NODE_ENV=production`, o que faz o `npm ci` pular as `devDependencies` —
> e `vite`/`typescript` são devDependencies aqui. Mesma causa raiz do
> `nest: not found` que tivemos no Railway (ver `DECISOES.md`), mas a
> correção é mais simples: como o comando de build inteiro é nosso, dá
> para resolver direto nele, sem depender de nenhuma configuração da
> plataforma.

2. Depois do primeiro deploy de cada um, vá em **Custom domains** e
   adicione:
   - Landing → `impactdev.site` e `www.impactdev.site`
   - Storefront → `loja.impactdev.site`
   - Admin → `painel.impactdev.site`

   Como o domínio já está na Cloudflare, ela cria os registros DNS sozinha
   — não precisa mexer em nada manualmente aqui.

---

## 4. Depois de tudo no ar

1. Abra `https://impactdev.site` — confira que a landing carrega
2. Abra `https://loja.impactdev.site` — monte um pedido de teste
3. Abra `https://painel.impactdev.site` — faça login com
   `admin@adventureburguer.com.br`
4. **Configure o 2FA de verdade no seu celular.** Em produção o código
   exige a segunda etapa sempre (não dá para desligar) — no primeiro
   login vai aparecer o QR Code, escaneie com Google Authenticator ou Authy
5. Apague o pedido de teste que você acabou de criar no painel

### Trocar o botão da landing para apontar pra loja nova

Enquanto isso não for feito, o botão "Peça Online" da landing continua
indo para o WhatsMenu. Quando quiser migrar, troque uma linha:

```js
// apps/landing/assets/js/main.js, linha 9
const LINK_PEDIDO = 'https://loja.impactdev.site';
```

---

## O que ainda falta (de propósito, adiado)

| Pendência | Efeito enquanto não existir |
|---|---|
| Mercado Pago | Pedido PIX/cartão fica preso em "aguardando pagamento" para sempre |
| WhatsApp | Nenhuma mensagem automática é enviada ao cliente |
| Zonas de entrega e cupons reais | Os valores atuais (`R$ 5,00` Cidade Nova, cupom `BEMVINDO10`, etc.) são só exemplo — revise em **Prisma Studio** antes de divulgar para clientes de verdade |
| Rollups do dashboard | Relatórios consultam a tabela de pedidos direto; ver `DECISOES.md` |

---

## Referência rápida — onde cada coisa mora

| Peça | Serviço | Custo |
|---|---|---|
| DNS | Cloudflare | Grátis |
| API | Railway | ~US$5/mês após o crédito inicial |
| Landing, Storefront, Admin | Cloudflare Pages | Grátis |
| Banco | Neon (já em uso) | Grátis no plano atual |
