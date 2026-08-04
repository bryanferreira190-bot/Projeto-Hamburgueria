import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api';
import { adminApi } from '../../lib/adminApi';
import { useAdminAuth } from '../../lib/adminAuth';
import { Button, Field, Input } from '../../components/ui';

type Etapa = { nome: 'SENHA' } | { nome: 'CODIGO'; challengeToken: string };

export function AdminLogin() {
  const entrar = useAdminAuth((estado) => estado.entrar);

  const [etapa, setEtapa] = useState<Etapa>({ nome: 'SENHA' });
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const executar = async (acao: () => Promise<void>) => {
    setErro(null);
    setCarregando(true);
    try {
      await acao();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.detail : 'Algo deu errado. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  const autenticar = () =>
    executar(async () => {
      const resultado = await adminApi.login(email, senha);

      if (resultado.status === 'AUTHENTICATED') {
        entrar(resultado.accessToken, resultado.admin);
        return;
      }

      if (resultado.status === 'TOTP_REQUIRED') {
        setEtapa({ nome: 'CODIGO', challengeToken: resultado.challengeToken });
        return;
      }

      /* A configuracao inicial do 2FA acontece no painel completo, que ja
         tem a tela de QR Code. Duplicar aquele fluxo aqui so para o
         cardapio nao se paga. */
      setErro(
        'Sua conta ainda precisa configurar a verificação em duas etapas. Faça isso no painel administrativo.',
      );
    });

  const confirmarCodigo = () =>
    executar(async () => {
      if (etapa.nome !== 'CODIGO') return;
      const resultado = await adminApi.loginTotp(etapa.challengeToken, codigo);
      if (resultado.status === 'AUTHENTICATED') {
        entrar(resultado.accessToken, resultado.admin);
      }
    });

  return (
    <div className="mx-auto max-w-sm px-5 py-16">
      <div className="mb-6 text-center">
        <h1 className="titulo-display text-2xl">
          Gerenciar <span className="text-amarelo">cardápio</span>
        </h1>
        <p className="mt-1 text-sm text-cinza-2">Acesso restrito</p>
      </div>

      <div className="rounded-2xl border border-borda bg-preto-2 p-6">
        {etapa.nome === 'SENHA' ? (
          <form
            className="space-y-4"
            onSubmit={(evento) => {
              evento.preventDefault();
              void autenticar();
            }}
          >
            <Field label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </Field>
            <Field label="Senha">
              <Input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
              />
            </Field>

            {erro && <Alerta>{erro}</Alerta>}

            <Button full size="lg" type="submit" loading={carregando} disabled={!email || !senha}>
              Entrar
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(evento) => {
              evento.preventDefault();
              void confirmarCodigo();
            }}
          >
            <div className="text-center">
              <span className="text-3xl" aria-hidden>
                🔐
              </span>
              <p className="mt-2 text-sm text-cinza">
                Digite o código de 6 dígitos do seu aplicativo autenticador.
              </p>
            </div>

            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
              className="text-center text-2xl tracking-[0.4em]"
            />

            {erro && <Alerta>{erro}</Alerta>}

            <Button
              full
              size="lg"
              type="submit"
              loading={carregando}
              disabled={codigo.length !== 6}
            >
              Verificar
            </Button>
            <Button
              full
              variant="fantasma"
              type="button"
              onClick={() => {
                setEtapa({ nome: 'SENHA' });
                setCodigo('');
                setErro(null);
              }}
            >
              Voltar
            </Button>
          </form>
        )}
      </div>

      <Link to="/" className="mt-6 block text-center text-sm text-cinza underline">
        Voltar ao cardápio
      </Link>
    </div>
  );
}

function Alerta({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-vermelho/40 bg-vermelho/10 px-3 py-2 text-sm text-vermelho-2"
    >
      {children}
    </p>
  );
}
