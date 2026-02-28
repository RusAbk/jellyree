-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "title" TEXT,
    "relativePath" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "adjustments" JSONB,
    "capturedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Media_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("adjustments", "capturedAt", "createdAt", "filePath", "filename", "height", "id", "mimeType", "ownerId", "relativePath", "sizeBytes", "title", "updatedAt", "width") SELECT "adjustments", "capturedAt", "createdAt", "filePath", "filename", "height", "id", "mimeType", "ownerId", "relativePath", "sizeBytes", "title", "updatedAt", "width" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_ownerId_idx" ON "Media"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
