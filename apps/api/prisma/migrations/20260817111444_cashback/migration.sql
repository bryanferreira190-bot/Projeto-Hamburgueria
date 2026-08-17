-- Programa de cashback: 5% do valor pago em dinheiro volta como credito
-- com validade propria. Ver DECISOES.md.

-- 1) Regras comerciais na loja, e nao como constante no codigo: mudar o
--    percentual ou a validade nao deveria exigir deploy. Todas com
--    DEFAULT, entao a linha da loja ja existente e preenchida sozinha.
ALTER TABLE "store" ADD COLUMN "cashbackPercent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "store" ADD COLUMN "cashbackExpiryDays" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "store" ADD COLUMN "cashbackMaxRedeemPercent" INTEGER NOT NULL DEFAULT 50;

-- 2) Quanto de cada pedido foi pago com cashback. Separado de
--    discountCents (cupom) de proposito: no fechamento de caixa, desconto
--    promocional e saldo conquistado pelo cliente sao coisas diferentes.
ALTER TABLE "order" ADD COLUMN "cashbackUsedCents" INTEGER NOT NULL DEFAULT 0;

-- 3) Os creditos. Modelo de LOTES: cada pedido concluido gera um credito
--    com validade propria, em vez de um saldo unico no cliente -- so
--    assim da para saber QUANTO expira amanha (que e a informacao do
--    aviso no WhatsApp) e consumir primeiro o que vence antes.
CREATE TABLE "cashback_credit" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "remainingCents" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "orderId" UUID NOT NULL,
    "expiredAt" TIMESTAMP(3),
    "expiryWarningSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashback_credit_pkey" PRIMARY KEY ("id")
);

-- Um pedido gera no maximo um credito: protege contra creditar duas
-- vezes se a conclusao do pedido for processada em duplicidade.
CREATE UNIQUE INDEX "cashback_credit_orderId_key" ON "cashback_credit"("orderId");
-- Saldo do cliente: filtra por cliente + validade.
CREATE INDEX "cashback_credit_customerId_expiresAt_idx" ON "cashback_credit"("customerId", "expiresAt");
-- Jobs de expiracao e de aviso: varrem por loja + validade.
CREATE INDEX "cashback_credit_storeId_expiresAt_idx" ON "cashback_credit"("storeId", "expiresAt");

ALTER TABLE "cashback_credit" ADD CONSTRAINT "cashback_credit_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashback_credit" ADD CONSTRAINT "cashback_credit_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT no pedido: apagar um pedido que gerou cashback deixaria o
-- credito orfao, sem como auditar de onde veio.
ALTER TABLE "cashback_credit" ADD CONSTRAINT "cashback_credit_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
