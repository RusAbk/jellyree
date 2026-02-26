import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { isAbsolute, resolve } from 'path';
import { existsSync } from 'fs';

function normalizeSqliteUrl(raw: string) {
  const candidateA = resolve(__dirname, '..', '..', '..');
  const candidateB = resolve(__dirname, '..', '..');
  const serverRoot = existsSync(resolve(candidateA, 'prisma'))
    ? candidateA
    : candidateB;

  if (raw === ':memory:') {
    return raw;
  }

  if (raw.startsWith('file:')) {
    const normalized = raw.replace('file:', '');
    if (isAbsolute(normalized)) {
      return normalized;
    }
    return resolve(serverRoot, normalized);
  }

  if (!isAbsolute(raw)) {
    return resolve(serverRoot, raw);
  }

  return raw;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = normalizeSqliteUrl(process.env.DATABASE_URL || 'file:./dev.db');
    const adapter = new PrismaBetterSqlite3({ url });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
