# jellyree

Cloud file storage + photo gallery (Google Photos style MVP) built with NestJS + Vue.

## Implemented MVP
- Authentication (register/login via JWT)
- Upload files and whole folders (drag-and-drop or file picker)
- Gallery grid with adjustable thumbnail size
- Albums (create album, filter by album, bulk move to album)
- Tags (single media and bulk tagging)
- Inspector panel in view mode (rename, edit tags, delete)
- Simple non-destructive editing controls (brightness, contrast, color, crop zoom)
- Favorites (toggle on media, dedicated Favorites section, quick access in lightbox)

## Requirements
- Node.js 20+
- npm 10+

## Quick start
```bash
npm install
cd server
npx prisma migrate dev --name init
npm run dev:server
```

Add R2 env vars in `server/.env`:
```bash
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=jellyree
# if ACCOUNT_ID is unknown, set endpoint explicitly
# R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
```

In another terminal:
```bash
npm run dev:web
```

## Project structure
- server: NestJS API + Prisma + SQLite
- web: Vue 3 + Vite UI

## Notes
- API: http://localhost:3000
- UI: http://localhost:5173
- Uploaded files are stored in Cloudflare R2 (S3-compatible)
- `server/uploads` is used only as temporary upload buffer
