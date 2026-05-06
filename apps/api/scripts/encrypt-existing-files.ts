#!/usr/bin/env tsx
/**
 * Migra archivos de justificación existentes a AES-256-GCM.
 * Idempotente: salta registros que ya tienen fileIv en DB.
 *
 * Uso:
 * FILE_ENC_KEY=<64hex> DATABASE_URL=... pnpm --filter @asistencia/api exec tsx scripts/encrypt-existing-files.ts
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

import { encryptBuffer, getFileEncKey } from '../src/justifications/file-crypto.js';

const prisma = new PrismaClient();

async function main() {
  const key = getFileEncKey();

  const pending = await prisma.attendanceJustification.findMany({
    where: { fileIv: null, filePath: { not: '' } },
    select: { id: true, filePath: true },
  });

  console.log(`[encrypt-existing] ${pending.length} archivos a cifrar`);

  let ok = 0;
  let skipped = 0;
  let errors = 0;

  for (const justification of pending) {
    if (!existsSync(justification.filePath)) {
      console.warn(`  SKIP [${justification.id}] archivo no existe: ${justification.filePath}`);
      skipped += 1;
      continue;
    }

    try {
      const plain = await readFile(justification.filePath);
      const { encrypted, iv } = encryptBuffer(plain, key);
      await writeFile(justification.filePath, encrypted);
      await prisma.attendanceJustification.update({
        where: { id: justification.id },
        data: { fileIv: iv },
      });
      console.log(`  OK [${justification.id}]`);
      ok += 1;
    } catch (error) {
      console.error(`  ERROR [${justification.id}]:`, error);
      errors += 1;
    }
  }

  console.log(`\nResumen: ${ok} cifrados, ${skipped} omitidos, ${errors} errores`);
  if (errors > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
