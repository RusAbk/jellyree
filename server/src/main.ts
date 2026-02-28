import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

function parseCorsOrigins(raw: string | undefined) {
  if (!raw || raw.trim() === '' || raw.trim() === '*') {
    return true;
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  const corsCredentials = (process.env.CORS_CREDENTIALS || 'true').toLowerCase() !== 'false';

  app.enableCors({
    origin: corsOrigins,
    credentials: corsCredentials,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
