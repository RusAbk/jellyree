import Database from 'better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient, ShareAccessMode, ShareResourceType } from '@prisma/client'
import { resolve } from 'node:path'

const sqlitePath = resolve(process.cwd(), 'dev.db')
const sqlite = new Database(sqlitePath, { readonly: true })
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(connectionString) })

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function bool(value) {
  return Boolean(value)
}

function readRows(tableName) {
  return sqlite.prepare(`SELECT * FROM \"${tableName}\"`).all()
}

async function main() {
  const users = readRows('User')
  const albums = readRows('Album')
  const media = readRows('Media')
  const tags = readRows('Tag')
  const mediaTags = readRows('MediaTag')
  const albumMedia = readRows('AlbumMedia')
  const mediaRevisions = readRows('MediaRevision')
  let shareAccess = []
  try {
    shareAccess = readRows('PublicShareAccess')
  } catch {
    shareAccess = []
  }

  await prisma.mediaRevision.deleteMany()
  await prisma.mediaTag.deleteMany()
  await prisma.albumMedia.deleteMany()
  await prisma.publicShareAccess.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.media.deleteMany()
  await prisma.album.deleteMany()
  await prisma.user.deleteMany()

    if (users.length > 0) {
      await prisma.user.createMany({
        data: users.map((row) => ({
          id: row.id,
          email: row.email,
          passwordHash: row.passwordHash,
          displayName: row.displayName,
          createdAt: parseDate(row.createdAt) ?? new Date(),
          updatedAt: parseDate(row.updatedAt) ?? new Date(),
        })),
      })
    }

    if (albums.length > 0) {
      await prisma.album.createMany({
        data: albums.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          ownerId: row.ownerId,
          parentId: row.parentId,
          createdAt: parseDate(row.createdAt) ?? new Date(),
          updatedAt: parseDate(row.updatedAt) ?? new Date(),
        })),
      })
    }

    if (media.length > 0) {
      await prisma.media.createMany({
        data: media.map((row) => ({
          id: row.id,
          ownerId: row.ownerId,
          filePath: row.filePath,
          filename: row.filename,
          relativePath: row.relativePath,
          isFavorite: bool(row.isFavorite),
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes) || 0,
          width: row.width == null ? null : Number(row.width),
          height: row.height == null ? null : Number(row.height),
          adjustments: parseJson(row.adjustments),
          capturedAt: parseDate(row.capturedAt),
          metadataCreatedAt: parseDate(row.metadataCreatedAt),
          metadataModifiedAt: parseDate(row.metadataModifiedAt),
          latitude: row.latitude == null ? null : Number(row.latitude),
          longitude: row.longitude == null ? null : Number(row.longitude),
          createdAt: parseDate(row.createdAt) ?? new Date(),
          updatedAt: parseDate(row.updatedAt) ?? new Date(),
        })),
      })
    }

    if (tags.length > 0) {
      await prisma.tag.createMany({
        data: tags.map((row) => ({
          id: row.id,
          ownerId: row.ownerId,
          name: row.name,
          createdAt: parseDate(row.createdAt) ?? new Date(),
          updatedAt: parseDate(row.updatedAt) ?? new Date(),
        })),
      })
    }

    if (mediaTags.length > 0) {
      await prisma.mediaTag.createMany({
        data: mediaTags.map((row) => ({
          mediaId: row.mediaId,
          tagId: row.tagId,
          taggedAt: parseDate(row.taggedAt) ?? new Date(),
        })),
      })
    }

    if (albumMedia.length > 0) {
      await prisma.albumMedia.createMany({
        data: albumMedia.map((row) => ({
          albumId: row.albumId,
          mediaId: row.mediaId,
          position: row.position == null ? null : Number(row.position),
        })),
      })
    }

    if (mediaRevisions.length > 0) {
      await prisma.mediaRevision.createMany({
        data: mediaRevisions.map((row) => ({
          id: row.id,
          mediaId: row.mediaId,
          filePath: row.filePath,
          sizeBytes: Number(row.sizeBytes) || 0,
          width: row.width == null ? null : Number(row.width),
          height: row.height == null ? null : Number(row.height),
          createdAt: parseDate(row.createdAt) ?? new Date(),
        })),
      })
    }

    if (shareAccess.length > 0) {
      await prisma.publicShareAccess.createMany({
        data: shareAccess.map((row) => ({
          id: row.id,
          ownerId: row.ownerId,
          resourceType: row.resourceType === 'ALBUM' ? ShareResourceType.ALBUM : ShareResourceType.MEDIA,
          resourceId: row.resourceId,
          token: row.token,
          enabled: bool(row.enabled),
          accessMode: row.accessMode === 'PASSWORD' ? ShareAccessMode.PASSWORD : ShareAccessMode.LINK,
          passwordHash: row.passwordHash,
          expiresAt: parseDate(row.expiresAt),
          createdAt: parseDate(row.createdAt) ?? new Date(),
          updatedAt: parseDate(row.updatedAt) ?? new Date(),
        })),
      })
    }


  const summary = {
    users: users.length,
    albums: albums.length,
    media: media.length,
    tags: tags.length,
    mediaTags: mediaTags.length,
    albumMedia: albumMedia.length,
    mediaRevisions: mediaRevisions.length,
    shareAccess: shareAccess.length,
  }

  console.log('Migration complete:', summary)
}

main()
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    sqlite.close()
    await prisma.$disconnect()
  })
