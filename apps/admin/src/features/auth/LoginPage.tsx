import { useState } from 'react';
import { ApiError, api, totpEnableWithToken, totpSetupWithToken } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Field, Input } from '../../components/ui';

type Etapa =
  | { nome: 'SENHA' }
  | { nome: 'CODIGO'; challengeToken: string }
  | {
      nome: 'CONFIGURAR_2FA';
      setupToken: string;
      qrCode: string;
      secret: string;
    };

export function LoginPage() {
  const setSession = useAuth((state) => state.setSession);

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
    } catch (error) {
      setErro(error instanceof ApiError ? error.detail : 'Algo deu errado. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  const entrar = () =>
    executar(async () => {
      const resultado = await api.login(email, senha);

      if (resultado.status === 'AUTHENTICATED') {
        setSession(resultado.accessToken, resultado.admin);
        return;
      }

      if (resultado.status === 'TOTP_REQUIRED') {
        setEtapa({ nome: 'CODIGO', challengeToken: resultado.challengeToken });
        return;
      }

      /* Perfil exige 2FA e ainda nao configurou: entra no fluxo de setup,
         que e a unica coisa que o token restrito autoriza. */
      const setup = await totpSetupWithToken(resultado.setupToken);
      setEtapa({
        nome: 'CONFIGURAR_2FA',
        setupToken: resultado.setupToken,
        qrCode: setup.qrCode,
        secret: setup.secret,
      });
    });

  const confirmarCodigo = () =>
    executar(async () => {
      if (etapa.nome !== 'CODIGO') return;
      const resultado = await api.loginTotp(etapa.challengeToken, codigo);
      if (resultado.status === 'AUTHENTICATED') {
        setSession(resultado.accessToken, resultado.admin);
      }
    });

  const ativar2fa = () =>
    executar(async () => {
      if (etapa.nome !== 'CONFIGURAR_2FA') return;
      await totpEnableWithToken(etapa.setupToken, codigo);
      /* Ativado: refaz o login, agora passando pela segunda etapa. */
      setCodigo('');
      setEtapa({ nome: 'SENHA' });
      setErro(null);
    });

  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            className="mx-auto mb-3 size-16 rounded-full border-2 border-amarelo object-cover"
          />
          <h1 className="titulo-display text-2xl">
            Painel <span className="text-amarelo">Adventure</span>
          </h1>
          <p className="mt-1 text-sm text-cinza-2">Acesso restrito à equipe</p>
        </div>

        <div className="rounded-xl border border-borda bg-preto-2 p-6">
          {etapa.nome === 'SENHA' && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void entrar();
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
          )}

          {etapa.nome === 'CODIGO' && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmarCodigo();
              }}
            >
              <div className="text-center">
                <span className="text-3xl" aria-hidden>
                  🔐
                </span>
                <h2 className="titulo-display mt-2 text-lg">Verificação em duas etapas</h2>
                <p className="mt-1 text-sm text-cinza">
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
                className="tabular text-center text-2xl tracking-[0.4em]"
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
                variant="sutil"
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

          {etapa.nome === 'CONFIGURAR_2FA' && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void ativar2fa();
              }}
            >
              <div className="text-center">
                <h2 className="titulo-display text-lg">Configure a segunda etapa</h2>
                <p className="mt-1 text-sm text-cinza">
                  Seu perfil exige verificação em duas etapas. Escaneie o código no Google
                  Authenticator, Authy ou 1Password.
                </p>
              </div>

              <img
                src={etapa.qrCode}
                alt="QR Code para configurar a autenticação em duas etapas"
                className="mx-auto rounded-lg bg-white p-2"
                width={200}
                height={200}
              />

              <details className="text-center text-xs text-cinza-2">
                <summary className="cursor-pointer">Não consegue escanear?</summary>
                <code className="mt-2 block break-all rounded bg-preto-3 p-2 text-cinza">
                  {etapa.secret}
                </code>
              </details>

              <Field label="Código do aplicativo">
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  className="tabular text-center text-xl tracking-[0.3em]"
                />
              </Field>

              {erro && <Alerta>{erro}</Alerta>}

              <Button
                full
                size="lg"
                type="submit"
                loading={carregando}
                disabled={codigo.length !== 6}
              >
                Ativar e continuar
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Alerta({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-vermelho/40 bg-vermelho/10 px-3 py-2 text-sm text-vermelho-2"
    >
      {children}
    </p>
  );
}
