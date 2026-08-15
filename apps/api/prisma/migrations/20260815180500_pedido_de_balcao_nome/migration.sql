-- Nome dito no balcao por quem nao deixou telefone.
--
-- Sem telefone nao ha Customer onde guardar o nome (o telefone e a chave
-- unica do cliente), e e por este nome que a cozinha chama a pessoa
-- quando o pedido fica pronto. Guardar em "notes" misturaria
-- identificacao com observacao do pedido ("sem cebola"), que sao coisas
-- diferentes e aparecem em lugares diferentes na tela da cozinha.
ALTER TABLE "order" ADD COLUMN "manualCustomerName" VARCHAR(120);
