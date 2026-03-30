import { v4 as uuidv4 } from 'uuid';

export function generateCustomerCode(): string {
  // 格式：CUST-XXXXXXXX（8位大写十六进制）
  const uid = uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
  return `CUST-${uid}`;
}
