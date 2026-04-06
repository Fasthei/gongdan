const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.engineer.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, username: true, email: true }
  });
  console.log('ADMIN 账号:');
  admins.forEach(a => console.log(`  id=${a.id} username=${a.username} email=${a.email}`));

  const engineers = await prisma.engineer.findMany({
    select: { id: true, username: true, role: true, level: true }
  });
  console.log('\n所有工程师:');
  engineers.forEach(e => console.log(`  ${e.username} (${e.role}, ${e.level})`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
