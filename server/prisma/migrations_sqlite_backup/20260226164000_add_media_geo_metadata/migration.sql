ALTER TABLE "Media" ADD COLUMN "latitude" REAL;
ALTER TABLE "Media" ADD COLUMN "longitude" REAL;

CREATE INDEX "Media_capturedAt_idx" ON "Media"("capturedAt");
