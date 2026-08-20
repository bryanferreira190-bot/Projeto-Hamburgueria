-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('ORDER_RECEIVED', 'PAYMENT_APPROVED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "message" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" VARCHAR(500),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_storeId_event_key" ON "notification_template"("storeId", "event");

-- CreateIndex
CREATE INDEX "notification_log_orderId_event_idx" ON "notification_log"("orderId", "event");

-- CreateIndex
CREATE INDEX "notification_log_storeId_sentAt_idx" ON "notification_log"("storeId", "sentAt");

-- AddForeignKey
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
