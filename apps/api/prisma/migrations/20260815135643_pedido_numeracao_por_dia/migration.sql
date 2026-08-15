-- A numeracao curta do pedido ("A001") reinicia a cada dia, mas ate aqui
-- so era unica GLOBALMENTE (storeId, number) -- entao o segundo dia com
-- pelo menos um pedido colidia com "A001" do dia anterior e a criacao de
-- QUALQUER pedido (nao so PIX/cartao) quebrava com 500. Ver DECISOES.md.
--
-- Coluna adicionada em 3 passos porque ja existem pedidos: nao da para
-- criar como NOT NULL direto sem valor para preencher as linhas atuais.

-- 1) coluna nullable
ALTER TABLE "order" ADD COLUMN "orderDate" DATE;

-- 2) preenche as linhas existentes a partir de createdAt, convertido do
--    fuso da loja. createdAt e "timestamp without time zone": os
--    numeros gravados sao UTC "nu", entao primeiro marca como UTC e so
--    depois converte para America/Sao_Paulo -- na ordem errada o
--    resultado sai errado sem erro nenhum avisando.
UPDATE "order"
SET "orderDate" = ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'))::date;

-- 3) agora sim NOT NULL
ALTER TABLE "order" ALTER COLUMN "orderDate" SET NOT NULL;

-- Troca o indice unico antigo (global) pelo novo (por dia)
DROP INDEX "order_storeId_number_key";
CREATE UNIQUE INDEX "order_storeId_orderDate_number_key" ON "order"("storeId", "orderDate", "number");
