# Registro de decisões técnicas

Decisões que não são óbvias pelo código, com o motivo por trás.
Formato: mais recente no topo.

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
2 MB por arquivo, o custo dessa dependência não se paga hoje.

**Por que é seguro nesta escala.** 30 produtos × 2 MB no pior caso = 60 MB,
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
