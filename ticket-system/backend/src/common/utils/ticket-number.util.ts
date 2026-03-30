import { v4 as uuidv4 } from 'uuid';

export function generateTicketNumber(): string {
  const year = new Date().getFullYear();
  // 取 UUID 前6位十六进制转为6位数字
  const uid = uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase();
  return `TK-${year}-${uid}`;
}
