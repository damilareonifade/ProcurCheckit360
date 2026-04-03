import { PrismaClient } from '../generated/prisma-client/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const seedUsers = [
  { email: 'john@example.com', name: 'John Doe' },
  { email: 'jane@example.com', name: 'Jane Smith' },
  { email: 'alice@example.com', name: 'Alice Johnson' },
  { email: 'bob@example.com', name: 'Bob Williams' },
  { email: 'charlie@example.com', name: 'Charlie Brown' },
];

async function main() {
  console.log('Seeding user_service_db...');

  for (const userData of seedUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existing) {
      console.log(`User ${userData.email} already exists (id: ${existing.id}), skipping.`);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        email: userData.email,
        name: userData.name,
      },
    });

    console.log(`Created user: ${user.email} (id: ${user.id})`);
  }

  console.log('User seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
