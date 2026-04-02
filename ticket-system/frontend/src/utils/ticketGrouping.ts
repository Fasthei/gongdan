import dayjs from 'dayjs';

export type TicketDateGroup<T> = {
  key: string;
  label: string;
  dateText: string;
  items: T[];
  isToday: boolean;
};

function toDateKey(input: any): string {
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY-MM-DD') : 'unknown';
}

export function groupTicketsByCreatedDate<T extends { createdAt?: string | Date }>(
  tickets: T[],
): TicketDateGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const t of tickets) {
    const key = toDateKey(t.createdAt);
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }

  const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
  const today = dayjs().format('YYYY-MM-DD');
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  return keys.map((key) => {
    const d = dayjs(key, 'YYYY-MM-DD', true);
    const dateText = d.isValid() ? d.format('MM-DD') : '未知日期';
    const label =
      key === today ? `今天 (${dateText})` : key === yesterday ? `昨天 (${dateText})` : `${key} (${dateText})`;
    return {
      key,
      label,
      dateText,
      items: map.get(key) || [],
      isToday: key === today,
    };
  });
}

