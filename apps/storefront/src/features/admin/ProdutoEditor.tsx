import { useState } from 'react';
import { PRODUCT_IMAGE_HINT, formatBRL, validateProductImage } from '@adventure/shared';
import { ApiError } from '../../lib/api';
import { adminApi } from '../../lib/adminApi';
import { resolveImageUrl } from '../../lib/imageUrl';
import { Button, Field, Input, Textarea } from '../../components/ui';
import { cx } from '../../lib/cx';

export interface ProdutoDoCardapio {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
}

/** Converte "28,90" ou "28.90" em 2890 centavos. */
function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, '').replace(',', '.');
  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return Math.round(numero * 100);
}

/** Centavos para o formato que a pessoa espera digitar: "28,90". */
function paraTexto(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

export function ProdutoEditor({
  produto,
  aoSalvar,
  aoFechar,
}: {
  produto: ProdutoDoCardapio;
  aoSalvar: () => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(produto.name);
  const [descricao, setDescricao] = useState(produto.description ?? '');
  const [preco, setPreco] = useState(paraTexto(produto.priceCents));
  const [disponivel, setDisponivel] = useState(produto.isAvailable);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  /* So vira chamada de verdade no salvar: fechar sem salvar nao apaga nada. */
  const [removerFoto, setRemoverFoto] = useState(false);

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const precoEmCentavos = paraCentavos(preco);
  const precoInvalido = preco.trim() !== '' && precoEmCentavos === null;

  const escolherArquivo = (file: File | undefined) => {
    setErro(null);
    if (!file) return;

    /* Mesma funcao que a API usa para validar — a mensagem que aparece
       aqui e exatamente a que o servidor daria. */
    const problema = validateProductImage({ size: file.size, type: file.type });
    if (problema) {
      setErro(problema);
      return;
    }

    setArquivo(file);
    setPrevia(URL.createObjectURL(file));
    /* Escolher uma foto nova cancela o pedido de remocao. */
    setRemoverFoto(false);
  };

  const salvar = async () => {
    setErro(null);

    if (nome.trim().length < 2) {
      setErro('O nome precisa de ao menos 2 caracteres.');
      return;
    }
    if (precoEmCentavos === null) {
      setErro('Informe um preço válido, como 28,90.');
      return;
    }

    setSalvando(true);
    try {
      /* Envia so o que mudou: assim salvar o preco nao reescreve a
         descricao com um valor que a pessoa nem tocou. */
      const alteracoes: Parameters<typeof adminApi.salvarProduto>[1] = {};
      if (nome.trim() !== produto.name) alteracoes.name = nome.trim();
      if (descricao.trim() !== (produto.description ?? ''))
        alteracoes.description = descricao.trim();
      if (precoEmCentavos !== produto.priceCents) alteracoes.priceCents = precoEmCentavos;
      if (disponivel !== produto.isAvailable) alteracoes.isAvailable = disponivel;

      if (Object.keys(alteracoes).length > 0) {
        await adminApi.salvarProduto(produto.id, alteracoes);
      }

      if (arquivo) {
        await adminApi.enviarFoto(produto.id, arquivo);
      } else if (removerFoto) {
        await adminApi.removerFoto(produto.id);
      }

      aoSalvar();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.detail : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const imagemExibida = previa ?? (removerFoto ? null : resolveImageUrl(produto.imageUrl));
  const temFotoParaRemover = Boolean(arquivo ?? (!removerFoto && produto.imageUrl));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div>
          <span className="mb-1.5 block text-sm font-semibold">Foto</span>

          <div className="relative aspect-square overflow-hidden rounded-xl border border-borda bg-carvao">
            {imagemExibida ? (
              <img src={imagemExibida} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-4xl">🍔</div>
            )}

            {previa && (
              <span className="absolute top-2 left-2 rounded-full bg-amarelo px-2 py-0.5 text-[0.65rem] font-bold text-preto">
                NOVA
              </span>
            )}

            {removerFoto && !previa && (
              <span className="absolute top-2 left-2 rounded-full bg-vermelho px-2 py-0.5 text-[0.65rem] font-bold text-white">
                SERÁ REMOVIDA
              </span>
            )}
          </div>

          <label className="mt-2 block cursor-pointer">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(evento) => escolherArquivo(evento.target.files?.[0])}
            />
            <span className="block rounded-full border border-amarelo/40 bg-amarelo/8 px-4 py-2 text-center text-sm font-bold text-amarelo transition-colors hover:bg-amarelo hover:text-preto">
              {arquivo ? 'Trocar novamente' : 'Escolher foto'}
            </span>
          </label>

          {temFotoParaRemover && (
            <button
              type="button"
              onClick={() => {
                setArquivo(null);
                setPrevia(null);
                setRemoverFoto(true);
              }}
              className="mt-2 w-full rounded-full px-4 py-1.5 text-sm font-semibold text-cinza-2 transition-colors hover:text-vermelho-2"
            >
              Remover foto
            </button>
          )}

          {removerFoto && (
            <button
              type="button"
              onClick={() => setRemoverFoto(false)}
              className="mt-2 w-full rounded-full px-4 py-1.5 text-sm font-semibold text-cinza-2 transition-colors hover:text-white"
            >
              Manter a foto atual
            </button>
          )}

          {/* A dica vem de @adventure/shared, a mesma constante que a API
              usa para validar — nunca vai prometer um limite diferente. */}
          <p className="mt-2 text-xs leading-relaxed text-cinza-2">{PRODUCT_IMAGE_HINT}</p>
        </div>

        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} />
          </Field>

          <Field label="Descrição" hint={`${descricao.length}/600 caracteres`}>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="Ingredientes, diferenciais, tamanho…"
            />
          </Field>

          <Field
            label="Preço"
            required
            error={precoInvalido ? 'Use um valor como 28,90' : undefined}
            hint={
              !precoInvalido && precoEmCentavos !== null
                ? `Vai aparecer como ${formatBRL(precoEmCentavos)}`
                : undefined
            }
          >
            <Input
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              inputMode="decimal"
              placeholder="28,90"
            />
          </Field>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-borda bg-preto-3 px-4 py-3">
            <input
              type="checkbox"
              checked={disponivel}
              onChange={(e) => setDisponivel(e.target.checked)}
              className="size-4 accent-[#ffc21a]"
            />
            <span className="text-sm">
              <span className="font-semibold">Disponível para pedido</span>
              <span className="block text-xs text-cinza-2">
                Desmarque para manter no cardápio, mas sem aceitar pedidos.
              </span>
            </span>
          </label>
        </div>
      </div>

      {erro && (
        <p
          role="alert"
          className="rounded-xl border border-vermelho/40 bg-vermelho/10 px-4 py-2.5 text-sm text-vermelho-2"
        >
          {erro}
        </p>
      )}

      <div className={cx('flex gap-3')}>
        <Button variant="fantasma" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button full onClick={() => void salvar()} loading={salvando} disabled={precoInvalido}>
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}
