DELETE FROM "AlbumMedia"
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM "AlbumMedia"
  GROUP BY "mediaId"
);

DROP INDEX IF EXISTS "AlbumMedia_mediaId_idx";
CREATE UNIQUE INDEX "AlbumMedia_mediaId_key" ON "AlbumMedia"("mediaId");
