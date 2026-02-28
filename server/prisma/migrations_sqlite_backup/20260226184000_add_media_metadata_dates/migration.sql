ALTER TABLE "Media" ADD COLUMN "metadataCreatedAt" DATETIME;
ALTER TABLE "Media" ADD COLUMN "metadataModifiedAt" DATETIME;

CREATE INDEX "Media_metadataCreatedAt_idx" ON "Media"("metadataCreatedAt");
