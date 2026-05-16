import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { randomBytes, scryptSync } from 'crypto';

const databaseUrl =
  process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/telecat';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `${salt}:${hash}`;
}

async function main() {
  const email = 'zzxcmdyx@gmail.com';
  const passwordHash = hashPassword('123456');

  await prisma.user.upsert({
    where: { email },
    update: {
      name: 'zzxcmdyx',
      passwordHash,
      friendCode: 'TCZZXCMDYX',
    },
    create: {
      email,
      name: 'zzxcmdyx',
      passwordHash,
      friendCode: 'TCZZXCMDYX',
    },
  });

  console.log(`Seeded default account: ${email} / 123456`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
