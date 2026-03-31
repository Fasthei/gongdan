/** 知识库对话 SSE 载荷（内部 smart-query 仍阻塞，仅发 status；主模型流式 token；AI 搜索可选 SSE） */
export type KbStreamPayload =
  | { type: 'session'; sessionId: string; usedSearchMode: 'internal' | 'hybrid' }
  | { type: 'status'; phase: string; detail?: string; tool?: string }
  /** 主模型 reasoning / thinking 流式片段，或 Agent 工具步骤（非最终回答正文） */
  | { type: 'llm_think'; text: string }
  | { type: 'token'; text: string; source: 'llm' }
  | { type: 'ai_search_token'; text: string }
  | { type: 'meta'; sources: unknown[]; followUps: string[]; confidence?: number }
  | { type: 'done'; messages: unknown[] }
  | { type: 'error'; message: string };

/** 工具侧推送流式片段，主循环与 agent.streamEvents 合并；close() 必须在 agent 结束后调用 */
export class KbSideQueue {
  private buf: KbStreamPayload[] = [];
  private waiters: Array<(r: IteratorResult<KbStreamPayload>) => void> = [];
  private closed = false;

  push(p: KbStreamPayload) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: p, done: false });
    else this.buf.push(p);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters) w({ done: true, value: undefined });
    this.waiters = [];
  }

  async *iterate(): AsyncGenerator<KbStreamPayload> {
    while (true) {
      if (this.buf.length) {
        yield this.buf.shift()!;
        continue;
      }
      if (this.closed) return;
      const n = await new Promise<IteratorResult<KbStreamPayload>>((resolve) => this.waiters.push(resolve));
      if (n.done) return;
      yield n.value!;
    }
  }
}

export async function* mergeAgentStreamAndQueue(
  agentIter: AsyncIterator<any>,
  queue: KbSideQueue,
): AsyncGenerator<{ src: 'agent'; ev: any } | { src: 'q'; p: KbStreamPayload }> {
  const qIt = queue.iterate()[Symbol.asyncIterator]();
  let nextA = agentIter.next();
  let nextQ = qIt.next();
  let aDone = false;
  let qDone = false;

  while (!aDone || !qDone) {
    const pending: Promise<{ tag: 'a' | 'q'; result: IteratorResult<any> }>[] = [];
    if (!aDone) pending.push(nextA.then((result) => ({ tag: 'a' as const, result })));
    if (!qDone) pending.push(nextQ.then((result) => ({ tag: 'q' as const, result })));
    if (pending.length === 0) break;
    const { tag, result } = await Promise.race(pending);
    if (tag === 'a') {
      if (result.done) {
        aDone = true;
        queue.close();
      } else {
        yield { src: 'agent', ev: result.value };
      }
      nextA = aDone ? Promise.resolve({ done: true, value: undefined }) : agentIter.next();
    } else {
      if (result.done) {
        qDone = true;
      } else {
        yield { src: 'q', p: result.value };
      }
      nextQ = qDone ? Promise.resolve({ done: true, value: undefined }) : qIt.next();
    }
  }
}
