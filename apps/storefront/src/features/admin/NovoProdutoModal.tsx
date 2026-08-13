import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { adminApi } from '../../lib/adminApi';
import { Button, Field, Input, Modal, Textarea } from '../../components/ui';

export interface CategoriaParaEscolha {
  id: string;
  name: string;
}

/** Converte "28,90" ou "28.90" em 2890 centavos. */
function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, '').replace(',', '.');
  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return Math.round(numero * 100);
}

export function NovoProdutoModal({
  categorias,
  aoSalvar,
  aoFechar,
}: {
  categorias: CategoriaParaEscolha[];
  aoSalvar: (nome: string) => void;
  aoFechar: () => void;
}) {
  const [categoryId, setCategoryId] = useState(categorias[0]?.id ?? '');
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [preco, setPreco] = useState('');
  const [disponivel, setDisponivel] = useState(true);

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const precoEmCentavos = paraCentavos(preco);
  const precoInvalido = preco.trim() !== '' && precoEmCentavos === null;

  const salvar = async () => {
    setErro(null);

    if (!categoryId) {
      setErro('Escolha uma categoria.');
      return;
    }
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
      const criado = await adminApi.criarProduto({
        categoryId,
        name: nome.trim(),
        ...(descricao.trim() ? { description: descricao.trim() } : {}),
        priceCents: precoEmCentavos,
        isAvailable: disponivel,
      });
      aoSalvar(criado.name);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.detail : 'Não foi possível cadastrar o produto.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Novo produto" aoFechar={aoFechar}>
      <div className="space-y-4">
        <Field label="Categoria" required>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-xl border border-borda bg-preto-3 px-4 py-3 text-white transition-colors focus:border-amarelo focus:outline-none"
          >
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nome" required>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={160}
            placeholder="Ex.: Bacon Especial"
            autoFocus
          />
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
              A foto se adiciona depois, editando o produto recém-criado.
            </span>
          </span>
        </label>

        {erro && (
          <p
            role="alert"
            className="rounded-xl border border-vermelho/40 bg-vermelho/10 px-4 py-2.5 text-sm text-vermelho-2"
          >
            {erro}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button full onClick={() => void salvar()} loading={salvando} disabled={precoInvalido}>
            Adicionar produto
          </Button>
        </div>
      </div>
    </Modal>
  );
}
