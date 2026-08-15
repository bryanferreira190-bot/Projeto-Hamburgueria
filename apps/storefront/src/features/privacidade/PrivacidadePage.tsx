import { Link } from 'react-router';

const ATUALIZADO_EM = '15 de agosto de 2026';

/**
 * Politica de privacidade, nos termos da LGPD (Lei 13.709/2018).
 *
 * O texto descreve o que o sistema REALMENTE faz hoje — coleta, uso,
 * compartilhamento e retencao — e nao uma lista generica copiada de
 * modelo. Ao mudar o que a loja coleta ou como usa os dados, atualize
 * este arquivo junto, e mude ATUALIZADO_EM.
 *
 */
export function PrivacidadePage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-cinza">
      <h1 className="titulo-display mb-2 text-3xl text-white">
        Política de <span className="text-amarelo">Privacidade</span>
      </h1>
      <p className="mb-8 text-xs text-cinza-2">Última atualização: {ATUALIZADO_EM}</p>

      <Secao titulo="Quem trata os seus dados">
        <p>
          A <strong className="text-white">Adventure Burguer</strong>, hamburgueria localizada em
          Av. da Paz Universal, 686 — Cidade Nova, Itu/SP, CEP 13308-125, CNPJ 37.203.959/0001-34,
          é quem decide como e por que seus dados pessoais são tratados ao usar este site
          (controladora, nos termos da LGPD).
        </p>
      </Secao>

      <Secao titulo="Quais dados coletamos e por quê">
        <p className="mb-3">Coletamos apenas o necessário para processar o seu pedido:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-white">Nome e WhatsApp</strong> — para identificar o pedido,
            avisar sobre o andamento e entrar em contato se algo precisar ser confirmado.
          </li>
          <li>
            <strong className="text-white">E-mail</strong> — apenas quando o pagamento é online
            (PIX ou cartão): é exigido pela Mercado Pago para gerar a cobrança.
          </li>
          <li>
            <strong className="text-white">Endereço de entrega</strong> — CEP, rua, número,
            complemento, bairro e ponto de referência, apenas para pedidos de entrega.
          </li>
          <li>
            <strong className="text-white">Dados do cartão</strong> — número, validade e CVV são
            digitados diretamente em campos da própria Mercado Pago (nunca chegam ao nosso
            servidor). Nome impresso no cartão e CPF do titular são enviados por nós à Mercado
            Pago só para gerar o token de pagamento; não guardamos nenhum dos dois.
          </li>
        </ul>
      </Secao>

      <Secao titulo="Com quem compartilhamos">
        <p>
          Compartilhamos os dados necessários ao pagamento com a{' '}
          <strong className="text-white">Mercado Pago</strong> (processadora de pagamentos), que
          trata esses dados como controladora independente, sob a própria política de privacidade
          dela. Não vendemos nem alugamos dados pessoais a terceiros, e não usamos seus dados para
          publicidade.
        </p>
      </Secao>

      <Secao titulo="Base legal">
        <p>
          Tratamos seus dados para{' '}
          <strong className="text-white">executar o contrato</strong> firmado ao fazer o pedido
          (art. 7º, V, da LGPD) — sem nome, telefone e endereço não há como preparar e entregar o
          pedido. O e-mail para pagamento online segue a mesma base. O aceite explícito marcado no
          checkout serve para deixar isso registrado de forma clara, mesmo quando a base legal já
          seria a execução do contrato.
        </p>
      </Secao>

      <Secao titulo="Como protegemos o acompanhamento do pedido">
        <p>
          O número do pedido (ex.: "A001") é curto e não é secreto — por isso, para ver os dados
          de um pedido pela tela de acompanhamento, também pedimos o WhatsApp usado nele. Só quem
          souber os dois consegue ver nome, endereço e status. Esse WhatsApp fica guardado apenas
          na memória temporária do seu navegador (
          <span className="text-white">sessionStorage</span>), e some ao fechar a aba.
        </p>
      </Secao>

      <Secao titulo="Cookies e armazenamento local">
        <p>
          Não usamos cookies de rastreamento nem de publicidade. Guardamos localmente no seu
          navegador apenas: o conteúdo do carrinho de compras (para não se perder ao atualizar a
          página) e, como descrito acima, o WhatsApp do pedido durante a sessão de acompanhamento.
          Nenhum desses dados é enviado a terceiros com fins de rastreamento.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo guardamos">
        <p>
          O histórico de pedidos é mantido pelo tempo necessário para fins fiscais, contábeis e de
          eventual disputa sobre a compra (garantia, estorno, cobrança). Dados de cartão nunca
          ficam guardados com a gente — apenas o token de uso único fica registrado, associado ao
          pedido.
        </p>
      </Secao>

      <Secao titulo="Seus direitos">
        <p className="mb-3">
          A LGPD garante o direito de confirmar se tratamos seus dados, acessá-los, corrigi-los,
          solicitar anonimização, eliminação ou portabilidade, e revogar o consentimento dado no
          checkout a qualquer momento.
        </p>
        <p>
          Para exercer qualquer um desses direitos, entre em contato pelo WhatsApp da loja
          informando o número do pedido. Faremos o possível para responder em até 15 dias.
        </p>
      </Secao>

      <Secao titulo="Alterações">
        <p>
          Podemos atualizar esta política para refletir mudanças no site ou na lei. A data no
          topo desta página sempre indica a versão mais recente.
        </p>
      </Secao>

      <Link to="/" className="mt-10 block text-center text-sm text-cinza underline">
        Voltar ao cardápio
      </Link>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="titulo-display mb-2 text-base text-white">{titulo}</h2>
      {children}
    </section>
  );
}
