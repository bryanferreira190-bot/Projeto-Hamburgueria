-- AlterTable
ALTER TABLE "product" ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageMimeType" VARCHAR(40),
ADD COLUMN     "imageVersion" INTEGER NOT NULL DEFAULT 0;
