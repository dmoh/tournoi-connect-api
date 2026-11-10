import { defineConfig } from 'prisma/config';

/**
 * Configuration Prisma 7 : schéma, migrations versionnées et base cible.
 * `prisma generate` n'a pas besoin de base ; `prisma migrate` échoue
 * clairement si DATABASE_URL manque.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
