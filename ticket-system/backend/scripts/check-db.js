const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 检查 TicketMessage 表是否存在
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'TicketMessage'
  `);
  console.log('TicketMessage 表:', tables.length > 0 ? '存在 ✓' : '不存在 ✗');

  // 检查枚举是否存在
  const enums = await prisma.$queryRawUnsafe(`
    SELECT typname FROM pg_type WHERE typname = 'MessageAuthorRole'
  `);
  console.log('MessageAuthorRole 枚举:', enums.length > 0 ? '存在 ✓' : '不存在 ✗');

  // 试查留言
  try {
    const count = await prisma.ticketMessage.count();
    console.log('TicketMessage 记录数:', count);
  } catch (e) {
    console.log('ticketMessage.count() 报错:', e.message);
  }

  // 检查 _prisma_migrations
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5
  `);
  console.log('\n最近迁移记录:');
  migrations.forEach(m => console.log(' -', m.migration_name, '| 完成:', m.finished_at, '| 回滚:', m.rolled_back_at));
}

main().catch(console.error).finally(() => prisma.$disconnect());
