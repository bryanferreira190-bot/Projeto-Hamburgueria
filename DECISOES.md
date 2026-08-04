# Registro de decisões técnicas

Decisões que não são óbvias pelo código, com o motivo por trás.
Formato: mais recente no topo.

---

## 2026-08-04 — `railway.json` não roda `npm ci` no `buildCommand`

**Sintoma.** Build no Railway falhava sempre no mesmo passo, com
`npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'`
(exit code 240).

**Causa.** O Nixpacks já roda `npm ci` sozinho na fase de instalação, antes
de qualquer `buildCommand` customizado (ele detecta o `package-lock.json` na
raiz e infere isso automaticamente). Esse `npm ci` automático usa um cache
mount do Docker em `node_modules/.cache`. O `railway.json` também chamava
`npm ci &&` no início do `buildCommand` — ou seja, `npm ci` rodava duas
vezes. Na segunda vez, ele tenta limpar `node_modules/.cache`, que ainda
está montado (busy) pela primeira execução, e falha.

**Decisão.** `buildCommand` só roda os passos de build
(`npm run build --workspace=...`), sem `npm ci` — a instalação fica
inteiramente a cargo da fase automática do Nixpacks.

**Quando revisar.** Se o build passar a exigir uma etapa de instalação
diferente do `npm ci` padrão (ex: flags extras), usar `nixpacks.toml` com
`phases.install.cmds`, não reintroduzir `npm ci` no `buildCommand`.

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
