import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Accept full URLs in env and normalize to scheme + host (+port),
  // because browser Origin header never includes path/query/fragment.
  try {
    const url = new URL(trimmed);
    return url.origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

function parseCorsOrigins(raw: string | undefined): true | Set<string> {
  if (!raw || raw.trim() === '' || raw.trim() === '*') {
    return true;
  }

  const origins = raw
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  return origins.length > 0 ? new Set(origins) : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  const corsCredentials = (process.env.CORS_CREDENTIALS || 'true').toLowerCase() !== 'false';

  app.enableCors({
    origin: (incomingOrigin, callback) => {
      // Allow non-browser requests with no Origin header.
      if (!incomingOrigin) {
        callback(null, true);
        return;
      }

      if (corsOrigins === true) {
        callback(null, true);
        return;
      }

      const normalizedIncomingOrigin = normalizeOrigin(incomingOrigin);
      if (corsOrigins.has(normalizedIncomingOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${incomingOrigin} is not allowed by CORS`), false);
    },
    credentials: corsCredentials,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Start-Byte'],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
    optionsSuccessStatus: 204,
  });
  await app.listen(process.env.PORT ?? 3000);

  const server = app.getHttpServer() as {
    requestTimeout?: number;
    timeout?: number;
    keepAliveTimeout?: number;
  };

  if (server) {
    server.requestTimeout = 0;
    server.timeout = 0;
    server.keepAliveTimeout = 65_000;
  }
}
bootstrap();
