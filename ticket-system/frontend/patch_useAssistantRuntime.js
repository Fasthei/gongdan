const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/common/KnowledgeBaseChat/useAssistantRuntime.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the imports and the hook implementation
content = `import { useLocalRuntime, ChatModelAdapter, ThreadAssistantMessagePart } from '@assistant-ui/react';
import { useMemo, useEffect } from 'react';
import { KbChatContextType } from './useKbChat';
import { apiUrl } from '../../../config/apiBase';

export function useAssistantRuntime(ctx: KbChatContextType) {
  const {
    chat,
    setChat,
    sessionId,
    setSessionId,
    searchMode,
    aiSearchDepth,
    sandboxMode,
    requestExampleText,
    docContextText,
    docContextName,
    isCustomer,
    verifiedCode,
    selectedTickets,
    setSources,
    setFollowUps,
    setSandboxStatus,
    setRetrievalStatus,
    setLlmThinkText,
    setAiSearchStreamText,
    llmThinkRef,
    aiSearchThinkEventsRef,
    setLoading,
    workspaceVisible,
    setWorkspaceText,
    setThinkHistory,
  } = ctx as any; // Cast to any to bypass the missing exports for now

  const chatModel = useMemo<ChatModelAdapter>(() => {
    return {
      async *run(options) {
        const messages = options.messages;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role !== 'user') return;

        const userText = lastMessage.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('');

        const buildTicketContext = (tickets: any[]): string => {
          if (!tickets.length) return '';
          return tickets
            .map((t, idx) =>
              [
                \`### 工单 \${idx + 1}\`,
                \`工单编号: \${t.ticketNumber || t.id || ''}\`,
                \`状态: \${t.status || ''}\`,
                \`平台: \${t.platform || ''}\`,
                \`模型: \${t.modelUsed || ''}\`,
                t.framework ? \`框架/应用: \${t.framework}\` : '',
                t.networkEnv ? \`网络环境: \${t.networkEnv}\` : '',
                t.accountInfo ? \`账号信息: \${t.accountInfo}\` : '',
                \`问题描述:\\n\${t.description || ''}\`,
              ]
                .filter(Boolean)
                .join('\\n')
            )
            .join('\\n\\n');
        };

        const buildSandboxRequestFromTickets = (tickets: any[]): string => {
          const samples = tickets
            .map((t) => (typeof t?.requestExample === 'string' ? t.requestExample.trim() : ''))
            .filter(Boolean);
          if (!samples.length) return '';
          return samples.join('\\n\\n# ---- 来自其他工单请求示例 ----\\n\\n');
        };

        const ticketContext = buildTicketContext(selectedTickets);
        const mergedMessage = ticketContext
          ? \`\${userText}\\n\\n---\\n【关联工单明细】\\n\${ticketContext}\`
          : userText;
        const ticketSandboxRequest = buildSandboxRequestFromTickets(selectedTickets);
        const finalRequestExample = requestExampleText.trim() || (sandboxMode ? ticketSandboxRequest : '');
        const finalDocContext = docContextText.trim();
        const finalDocName = docContextName.trim();

        const fetchWithAuthStream = async (url: string, init: RequestInit): Promise<Response> => {
          let token = localStorage.getItem('accessToken');
          const headers = new Headers(init.headers);
          if (token) headers.set('Authorization', \`Bearer \${token}\`);
          let res = await fetch(url, { ...init, headers });
          if (res.status === 401) {
            const rt = localStorage.getItem('refreshToken');
            if (rt) {
              const rr = await fetch(apiUrl('/api/auth/refresh'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: rt }),
              });
              if (rr.ok) {
                const d = await rr.json();
                localStorage.setItem('accessToken', d.accessToken);
                token = d.accessToken;
                headers.set('Authorization', \`Bearer \${token}\`);
                res = await fetch(url, { ...init, headers });
              }
            }
          }
          return res;
        };

        setLoading(true);
        setLlmThinkText('');
        llmThinkRef.current = '';
        aiSearchThinkEventsRef.current.clear();
        setSandboxStatus('');
        setRetrievalStatus('');
        setAiSearchStreamText('');

        let roundMode = searchMode;

        try {
          const res = await fetchWithAuthStream(apiUrl('/api/knowledge-base/chat/stream'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              sessionId: sessionId || undefined,
              message: mergedMessage,
              searchMode,
              ...(searchMode === 'hybrid' ? { aiSearchDepth } : {}),
              ...(sandboxMode && finalRequestExample
                ? { useSandbox: true, requestExample: finalRequestExample }
                : {}),
              ...(finalDocContext ? { docContext: finalDocContext, docName: finalDocName || undefined } : {}),
              ...(isCustomer ? { customerCode: verifiedCode } : {}),
            }),
          });

          if (!res.ok) {
            throw new Error(\`知识库对话失败（HTTP \${res.status}）\`);
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error('无法读取流式响应');
          const dec = new TextDecoder();
          let buf = '';
          let accText = '';
          let accReasoning = '';
          let sandboxState = '';
          let retrievalState = '';

          const pullSseBlocks = (input: string): { blocks: string[]; rest: string } => {
            const blocks: string[] = [];
            let rest = input;
            while (true) {
              const m = rest.match(/\\r?\\n\\r?\\n/);
              if (!m || m.index === undefined) break;
              const idx = m.index;
              blocks.push(rest.slice(0, idx));
              rest = rest.slice(idx + m[0].length);
            }
            return { blocks, rest };
          };

          const appendThinkDelta = (delta: string) => {
            if (!delta) return;
            setLlmThinkText((prev: string) => {
              const next = prev + delta;
              const max = 48000;
              const capped = next.length > max ? next.slice(next.length - max) : next;
              llmThinkRef.current = capped;
              return capped;
            });
          };

          const yieldState = () => {
            const content: any[] = [];
            if (sandboxState) {
              content.push({
                type: 'tool-call',
                toolCallId: 'sandbox',
                toolName: 'Daytona Sandbox',
                args: { status: sandboxState },
                argsText: JSON.stringify({ status: sandboxState }),
                result: sandboxState.includes('完成') ? 'Success' : undefined,
              });
            }
            if (retrievalState) {
              content.push({
                type: 'tool-call',
                toolCallId: 'retrieval',
                toolName: 'Knowledge Retrieval',
                args: { status: retrievalState },
                argsText: JSON.stringify({ status: retrievalState }),
                result: retrievalState.includes('完成') ? 'Success' : undefined,
              });
            }
            if (accReasoning) {
              content.push({ type: 'reasoning', text: accReasoning });
            }
            if (accText) {
              content.push({ type: 'text', text: accText });
            }
            return {
              content,
              metadata: { custom: { searchMode: roundMode } }
            };
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const { blocks, rest } = pullSseBlocks(buf);
            buf = rest;

            for (const block of blocks) {
              const lines = block.split(/\\r?\\n/).map((l) => l.replace(/\\r$/, ''));
              const dataLines = lines.filter((l) => l.trimStart().startsWith('data:'));
              if (!dataLines.length) continue;
              const raw = dataLines
                .map((l) => l.trimStart().replace(/^data:\\s?/i, '').trim())
                .join('\\n')
                .trim();

              if (!raw) continue;
              let json: any;
              try {
                json = JSON.parse(raw);
              } catch {
                continue;
              }

              if (json.type === 'session') {
                if (json.sessionId) {
                  setSessionId(json.sessionId);
                  localStorage.setItem('kb-chat-session-id', json.sessionId);
                }
                if (json.usedSearchMode) {
                  roundMode = json.usedSearchMode;
                }
              } else if (json.type === 'token' && json.source === 'llm' && typeof json.text === 'string') {
                accText += json.text;
                if (workspaceVisible) setWorkspaceText(accText);
                yield yieldState();
              } else if (json.type === 'llm_think' && typeof json.text === 'string' && json.text) {
                accReasoning += json.text;
                appendThinkDelta(json.text);
                yield yieldState();
              } else if (json.type === 'ai_search_token' && typeof json.text === 'string') {
                setAiSearchStreamText((s: string) => s + json.text);
              } else if (json.type === 'status') {
                if (json.phase === 'sandbox') {
                  sandboxState = json.detail === 'start' ? '正在 Daytona 沙盒中复现请求…' : '沙盒执行完成';
                  setSandboxStatus(sandboxState);
                } else if (json.phase === 'internal_kb') {
                  retrievalState = json.detail === 'start' ? '正在检索内部知识库…' : '内部知识库检索完成';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'ai_search') {
                  retrievalState = json.detail === 'start' ? '正在调用外部 AI 搜索…' : '外部 AI 搜索完成';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'jina_initialize') {
                  retrievalState = json.detail === 'start' ? '正在初始化 Jina MCP…' : 'Jina MCP 已就绪';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'jina_fast_search') {
                  retrievalState = json.detail === 'start' ? 'Fast 模式：正在外部检索…' : 'Fast 模式检索完成';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'deep_expand_query') {
                  retrievalState = json.detail === 'start' ? 'Deep 模式：正在扩展查询…' : 'Deep 模式：查询扩展完成';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'deep_parallel_search') {
                  retrievalState = json.detail === 'start' ? 'Deep 模式：并行检索中…' : 'Deep 模式：并行检索完成';
                  setRetrievalStatus(retrievalState);
                } else if (json.phase === 'deep_rerank') {
                  retrievalState = json.detail === 'start' ? 'Deep 模式：重排中…' : 'Deep 模式：重排完成';
                  setRetrievalStatus(retrievalState);
                  if (json.detail === 'start' && !aiSearchThinkEventsRef.current.has('deep_rerank')) {
                    aiSearchThinkEventsRef.current.add('deep_rerank');
                    accReasoning += '\\n▸ Deep 重排：根据问题语义对内外部候选来源重新排序。\\n';
                    appendThinkDelta('\\n▸ Deep 重排：根据问题语义对内外部候选来源重新排序。\\n');
                  }
                } else {
                  retrievalState = [json.phase, json.detail, json.tool].filter(Boolean).join(' · ') || '检索中…';
                  setRetrievalStatus(retrievalState);
                }
                yield yieldState();
              } else if (json.type === 'meta') {
                setSources(Array.isArray(json.sources) ? json.sources : []);
                setFollowUps(Array.isArray(json.followUps) ? json.followUps : []);
              } else if (json.type === 'done') {
                if (llmThinkRef.current.trim()) {
                  const currentThink = llmThinkRef.current.trim();
                  setThinkHistory((prev: any[]) => [
                    {
                      id: \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
                      question: userText,
                      think: currentThink,
                      searchMode: roundMode,
                      createdAt: new Date().toISOString(),
                    },
                    ...prev,
                  ].slice(0, 20));
                }
                setSandboxStatus('');
                setRetrievalStatus('');
                aiSearchThinkEventsRef.current.clear();
                setAiSearchStreamText('');
                yield yieldState();
              }
            }
          }
        } catch (err: any) {
          console.error(err);
          yield {
            content: [{ type: 'text', text: '知识库对话失败' }]
          };
        } finally {
          setLoading(false);
        }
      },
    };
  }, [
    sessionId, setSessionId, searchMode, aiSearchDepth, sandboxMode, requestExampleText,
    docContextText, docContextName, isCustomer, verifiedCode, selectedTickets,
    setSources, setFollowUps, setSandboxStatus, setRetrievalStatus, setLlmThinkText,
    setAiSearchStreamText, llmThinkRef, aiSearchThinkEventsRef, setLoading, workspaceVisible,
    setWorkspaceText, setThinkHistory
  ]);

  // Convert initial chat to ThreadMessage[]
  const initialMessages = useMemo(() => {
    return (chat as any[]).map((msg, idx) => ({
      id: msg.id || \`msg-\${idx}\`,
      role: msg.role,
      content: [{ type: 'text', text: msg.content || '' }],
      metadata: { custom: { searchMode: msg.searchMode } }
    }));
  }, []); // Only run once on mount

  const runtime = useLocalRuntime(chatModel, { initialMessages });

  // Sync runtime messages back to chat state for useKbChat logic
  useEffect(() => {
    return runtime.thread.subscribe(() => {
      const messages = runtime.thread.getState().messages;
      const newChat = messages.map(m => {
        const textContent = m.content.find((c: any) => c.type === 'text')?.text || '';
        return {
          id: m.id,
          role: m.role,
          content: textContent,
          searchMode: m.metadata?.custom?.searchMode
        };
      });
      setChat(newChat);
      localStorage.setItem('kb-chat-history', JSON.stringify(newChat));
    });
  }, [runtime, setChat]);

  return runtime;
}
`;

fs.writeFileSync(filePath, content, 'utf8');
