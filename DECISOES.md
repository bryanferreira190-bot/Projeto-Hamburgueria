# Registro de decisões técnicas

Decisões que não são óbvias pelo código, com o motivo por trás.
Formato: mais recente no topo.

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
