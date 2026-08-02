# Adventure Burguer — Landing Page

Landing page em HTML + CSS + JavaScript puro. Não precisa instalar nada.

---

## Como abrir

Dê **duplo clique em `index.html`**. Pronto.

---

## Estrutura

```
pjt Hamburgueria/
├── index.html                  ← todo o conteúdo e textos do site
├── gerar-placeholders.ps1      ← recria as imagens de exemplo (pode apagar depois)
├── LEIA-ME.md
└── assets/
    ├── css/style.css           ← cores, tamanhos e animações
    ├── js/main.js              ← link do pedido, horários, filtros
    └── img/
        ├── logo.png            ← SUBSTITUIR pela logo real
        ├── hero.jpg, promo-*.jpg, sobre-*.jpg, cta-bg.jpg
        └── produtos/           ← 27 fotos de produto
```

---

## Tamanhos das imagens

Substitua cada arquivo pela foto real **mantendo exatamente o mesmo nome**.
O site se ajusta sozinho. Todos os tamanhos também estão comentados dentro do `index.html`.

| Arquivo | Tamanho | Formato | Observação |
|---|---|---|---|
| `assets/img/logo.png` | **512 × 512 px** | PNG transparente | Aparece no topo e no rodapé |
| `assets/img/favicon.png` | **512 × 512 px** | PNG | Ícone da aba do navegador |
| `assets/img/hero.jpg` | **1920 × 1080 px** | JPG (até 400KB) | Foto de capa em tela cheia |
| `assets/img/og-cover.jpg` | **1200 × 630 px** | JPG | Miniatura no WhatsApp/Facebook |
| `assets/img/cta-bg.jpg` | **1920 × 700 px** | JPG | Fundo da faixa "Bateu a fome?" |
| `assets/img/promo-destaque.jpg` | **1200 × 900 px** | JPG | Promoção principal da home |
| `assets/img/promo-2.jpg` a `promo-4.jpg` | **800 × 600 px** | JPG | Cards de promoção secundários |
| `assets/img/sobre-1.jpg` | **1000 × 1200 px** | JPG | Foto vertical do "Quem Somos" |
| `assets/img/sobre-2.jpg` | **700 × 700 px** | JPG | Foto quadrada sobreposta |
| `assets/img/produtos/*.jpg` | **800 × 800 px** | JPG (até 200KB) | Todos os 27 produtos |

**Dica:** fotos com fundo escuro/preto combinam muito melhor com o visual do site.

---

## O link dos pedidos

Todos os botões e cards do cardápio abrem:

```
https://www.whatsmenu.com.br/adventureburguer
```

Isso é controlado por **uma única linha** em `assets/js/main.js`:

```js
const LINK_PEDIDO = 'https://www.whatsmenu.com.br/adventureburguer';
```

Trocou essa linha, trocou o destino do site inteiro. Qualquer elemento novo que receber
a classe `js-pedido` passa a apontar para lá automaticamente.

---

## Horário de funcionamento

O site mostra **"Aberto agora" / "Fechado no momento"** sozinho, em tempo real,
e marca o dia de hoje na lista. A tabela fica em `assets/js/main.js`:

```js
const HORARIOS = {
  0: { abre: '18:00', fecha: '22:30' }, // Domingo
  1: null,                              // Segunda — fechado
  2: null,                              // Terça  — fechado
  3: null,                              // Quarta — fechado
  4: { abre: '18:00', fecha: '22:30' }, // Quinta
  5: { abre: '18:00', fecha: '22:30' }, // Sexta
  6: { abre: '17:00', fecha: '22:30' }  // Sábado
};
```

> Ao mudar um horário aqui, mude também o texto correspondente na lista
> `<ul class="hours__list">` dentro do `index.html`.

---

## Cores

Todas centralizadas no topo de `assets/css/style.css`:

```css
--preto:    #0a0a0a;
--branco:   #ffffff;
--amarelo:  #ffc21a;
--vermelho: #e01f26;
```

---

## Adicionar um produto novo

Copie um bloco `<article class="card">` no `index.html`, troque:

1. `data-cat` → `classicos`, `especiais`, `combos`, `porcoes` ou `bebidas`
2. o `src` da imagem
3. o título e a descrição

O botão já vai funcionar, porque tem a classe `js-pedido`.

---

## Antes de publicar

- [ ] Trocar `assets/img/logo.png` pela logo real
- [ ] Trocar as fotos dos produtos
- [ ] Colocar o número real de WhatsApp no rodapé (`https://wa.me/5500000000000`)
- [ ] Conferir o @ do Instagram no rodapé
- [ ] Atualizar o texto da promoção do dia
- [ ] Apagar `gerar-placeholders.ps1` (opcional)

Para hospedar de graça: arraste a pasta inteira para [netlify.com/drop](https://app.netlify.com/drop).
