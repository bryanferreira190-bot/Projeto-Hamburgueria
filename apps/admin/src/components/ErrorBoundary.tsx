import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  quebrou: boolean;
}

/**
 * Rede de seguranca contra erro de renderizacao inesperado.
 *
 * Sem isto, um throw sincrono em qualquer tela (bug de render, resposta
 * da API em formato que ninguem previu) derrubava o painel inteiro e
 * deixava uma tela em branco — bem no meio do expediente, sem nenhuma
 * pista de como voltar. Error boundary e a UNICA forma de recuperar disso
 * no React — nao existe equivalente em hook, por isso e uma classe.
 *
 * So cobre erro de RENDER. Erro de rede/mutacao continua tratado onde ja
 * era (TanStack Query, com `erro`/`isError` local em cada tela).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { quebrou: false };

  static getDerivedStateFromError(): State {
    return { quebrou: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro nao tratado no painel:', error, info.componentStack);
  }

  override render() {
    if (!this.state.quebrou) return this.props.children;

    /* Renderizado no lugar so da rota atual (ver App.tsx): cabecalho,
       menu e sessao continuam de pe, entao dá pra trocar de aba mesmo
       sem recarregar. */
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-4xl" aria-hidden>
          😕
        </span>
        <h2 className="titulo-display text-lg">Algo deu errado nesta tela</h2>
        <p className="max-w-sm text-sm text-cinza">
          Tente trocar de aba ou recarregar a página. Se continuar, avise quem cuida do sistema.
        </p>
        <Button variant="contorno" size="sm" onClick={() => window.location.reload()}>
          Recarregar página
        </Button>
      </div>
    );
  }
}
