/* eslint-disable no-console */
const path = require('path')
const Database = require('better-sqlite3')
const { PrismaClient, ShareAccessMode, ShareResourceType } = require('@prisma/client')

function toDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

async function main() {
  const sqlitePath = path.resolve(__dirname, '..', 'dev.db')
  const sqlite = new Database(sqlitePath, { readonly: true })
  const prisma = new PrismaClient()

  try {
    const users = sqlite.prepare('SELECT * FROM "User"').all()
    const albums = sqlite.prepare('SELECT * FROM "Album"').all()
    const media = sqlite.prepare('SELECT * FROM "Media"').all()
    const tags = sqlite.prepare('SELECT * FROM "Tag"').all()
    const albumMedia = sqlite.prepare('SELECT * FROM "AlbumMedia"').all()
    const mediaTags = sqlite.prepare('SELECT * FROM "MediaTag"').all()
    const mediaRevisions = sqlite.prepare('SELECT * FROM "MediaRevision"').all()

    let shareAccess = []
    const tableExists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='PublicShareAccess'")
      .get()

    if (tableExists) {
      shareAccess = sqlite.prepare('SELECT * FROM "PublicShareAccess"').all()
    }

    await prisma.$transaction(async (tx) => {
      await tx.mediaRevision.deleteMany({})
      await tx.mediaTag.deleteMany({})
      await tx.albumMedia.deleteMany({})
      await tx.tag.deleteMany({})
      await tx.media.deleteMany({})
      await tx.album.deleteMany({})
      await tx.publicShareAccess.deleteMany({})
      await tx.user.deleteMany({})

      if (users.length) {
        await tx.user.createMany({
          data: users.map((row) => ({
            id: row.id,
            email: row.email,
            passwordHash: row.passwordHash,
            displayName: row.displayName,
            createdAt: toDate(row.createdAt) || new Date(),
            updatedAt: toDate(row.updatedAt) || new Date(),
          })),
        })
      }

      if (albums.length) {
        await tx.album.createMany({
          data: albums.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            ownerId: row.ownerId,
            parentId: row.parentId,
            createdAt: toDate(row.createdAt) || new Date(),
            updatedAt: toDate(row.updatedAt) || new Date(),
          })),
        })
      }

      if (media.length) {
        await tx.media.createMany({
          data: media.map((row) => ({
            id: row.id,
            ownerId: row.ownerId,
            filePath: row.filePath,
            filename: row.filename,
            relativePath: row.relativePath,
            isFavorite: Boolean(row.isFavorite),
            mimeType: row.mimeType,
            sizeBytes: Number(row.sizeBytes || 0),
            width: row.width == null ? null : Number(row.width),
            height: row.height == null ? null : Number(row.height),
            adjustments: parseJson(row.adjustments),
            capturedAt: toDate(row.capturedAt),
            metadataCreatedAt: toDate(row.metadataCreatedAt),
            metadataModifiedAt: toDate(row.metadataModifiedAt),
            latitude: row.latitude == null ? null : Number(row.latitude),
            longitude: row.longitude == null ? null : Number(row.longitude),
            createdAt: toDate(row.createdAt) || new Date(),
            updatedAt: toDate(row.updatedAt) || new Date(),
          })),
        })
      }

      if (tags.length) {
        await tx.tag.createMany({
          data: tags.map((row) => ({
            id: row.id,
            ownerId: row.ownerId,
            name: row.name,
            createdAt: toDate(row.createdAt) || new Date(),
            updatedAt: toDate(row.updatedAt) || new Date(),
          })),
        })
      }

      if (albumMedia.length) {
        await tx.albumMedia.createMany({
          data: albumMedia.map((row) => ({
            albumId: row.albumId,
            mediaId: row.mediaId,
            position: row.position == null ? null : Number(row.position),
          })),
        })
      }

      if (mediaTags.length) {
        await tx.mediaTag.createMany({
          data: mediaTags.map((row) => ({
            mediaId: row.mediaId,
            tagId: row.tagId,
            taggedAt: toDate(row.taggedAt) || new Date(),
          })),
        })
      }

      if (mediaRevisions.length) {
        await tx.mediaRevision.createMany({
          data: mediaRevisions.map((row) => ({
            id: row.id,
            mediaId: row.mediaId,
            filePath: row.filePath,
            sizeBytes: Number(row.sizeBytes || 0),
            width: row.width == null ? null : Number(row.width),
            height: row.height == null ? null : Number(row.height),
            createdAt: toDate(row.createdAt) || new Date(),
          })),
        })
      }

      if (shareAccess.length) {
        await tx.publicShareAccess.createMany({
          data: shareAccess.map((row) => ({
            id: row.id,
            ownerId: row.ownerId,
            resourceType: row.resourceType === 'ALBUM' ? ShareResourceType.ALBUM : ShareResourceType.MEDIA,
            resourceId: row.resourceId,
            token: row.token,
            enabled: Boolean(row.enabled),
            accessMode: row.accessMode === 'PASSWORD' ? ShareAccessMode.PASSWORD : ShareAccessMode.LINK,
            passwordHash: row.passwordHash,
            expiresAt: toDate(row.expiresAt),
            createdAt: toDate(row.createdAt) || new Date(),
            updatedAt: toDate(row.updatedAt) || new Date(),
          })),
        })
      }
    })

    console.log('SQLite -> MariaDB migration completed')
    console.log(`Users: ${users.length}, Albums: ${albums.length}, Media: ${media.length}`)
    console.log(`Tags: ${tags.length}, AlbumMedia: ${albumMedia.length}, MediaTags: ${mediaTags.length}`)
    console.log(`MediaRevisions: ${mediaRevisions.length}, PublicShareAccess: ${shareAccess.length}`)
  } finally {
    sqlite.close()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
