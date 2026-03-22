-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `isFrozen` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Media`
  ADD COLUMN `isArchived` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `archivedFromOwnerId` VARCHAR(191) NULL,
  ADD COLUMN `archivedFromDisplayName` VARCHAR(191) NULL,
  ADD COLUMN `archivedFromEmail` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Media_isArchived_idx` ON `Media`(`isArchived`);
