export type ChatItem = { role: 'user' | 'assistant'; content: string; searchMode?: 'internal' | 'hybrid' };
export type ThinkRound = {
  id: string;
  question: string;
  think: string;
  searchMode: 'internal' | 'hybrid';
  createdAt: string;
};
export type DocAttachment = {
  uid: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  kind: 'word' | 'txt' | 'table' | 'image';
  parsedText: string;
  error?: string;
};
