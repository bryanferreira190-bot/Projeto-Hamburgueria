-- Pedido lancado a mao no balcao pela cozinha.
--
-- 1) customerId vira opcional. Quem compra no balcao nem sempre deixa
--    telefone, e telefone e a identidade do Customer
--    (@@unique([storeId, phone])) -- exigir um so para registrar a venda
--    faria a cozinha inventar numero e sujar a base de clientes com dado
--    falso. Pedido de balcao sem telefone simplesmente nao tem cliente
--    associado. Ver DECISOES.md.
--
--    Afrouxar de NOT NULL para NULL nao mexe em nenhuma linha existente:
--    todos os pedidos atuais continuam com o customerId que ja tinham.
ALTER TABLE "order" ALTER COLUMN "customerId" DROP NOT NULL;

-- 2) Marca de origem. Sem isto nao daria para distinguir "cliente pediu
--    pelo site e vem retirar" de "cliente comprou no balcao" -- os dois
--    sao type = PICKUP.
--
--    DEFAULT false preenche as linhas existentes na propria adicao (todo
--    pedido de antes veio do site), entao da para ja criar NOT NULL sem o
--    passo separado de backfill.
ALTER TABLE "order" ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;
