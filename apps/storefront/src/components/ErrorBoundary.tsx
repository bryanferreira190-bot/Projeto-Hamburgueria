import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  quebrou: boolean;
}

/**
 * Rede de seguranca contra erro de renderizacao inesperado.
 *
 * Sem isto, um throw sincrono em qualquer componente (bug de render, dado
 * de resposta em formato que ninguem previu) derrubava a arvore inteira
 * do React e deixava uma tela em branco, sem nenhuma pista de que algo
 * quebrou nem como voltar. Error boundary e a UNICA forma de recuperar
 * disso no React — nao existe equivalente em hook, por isso e uma classe.
 *
 * So cobre erro de RENDER. Erro de rede/mutacao continua tratado onde ja
 * era (TanStack Query, com `erro`/`isError` local em cada tela) — este
 * componente nao interfere nisso.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { quebrou: false };

  static getDerivedStateFromError(): State {
    return { quebrou: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro nao tratado na interface:', error, info.componentStack);
  }

  override render() {
    if (!this.state.quebrou) return this.props.children;

    /* Dentro do <main>, nao substitui a pagina inteira: Header, Footer e
       o carrinho continuam de pe, entao a pessoa nao fica sem nenhuma
       navegacao so porque um componente quebrou. */
    return (
      <EmptyState
        icon="😕"
        title="Algo deu errado"
        description="Recarregue a página. Se o problema continuar, chame a loja pelo WhatsApp."
        action={<Button onClick={() => window.location.reload()}>Recarregar página</Button>}
      />
    );
  }
}
