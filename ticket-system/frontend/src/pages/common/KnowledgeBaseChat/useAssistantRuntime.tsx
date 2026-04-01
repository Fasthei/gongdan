import { useExternalStoreRuntime, ThreadMessageLike, AppendMessage } from '@assistant-ui/react';
import { useState, useCallback } from 'react';
import { KbChatContextType } from './useKbChat';

export function useAssistantRuntime(ctx: KbChatContextType) {
  const { chat, loading, ask } = ctx;

  const convertMessage = useCallback((msg: any): ThreadMessageLike => {
    return {
      role: msg.role,
      content: [{ type: 'text', text: msg.content || '' }],
    };
  }, []);

  const onNew = async (message: AppendMessage) => {
    if (message.content[0]?.type !== 'text') return;
    const text = message.content[0].text;
    ctx.setQuestion(text);
    // We need to trigger `ask` but `ask` reads from `question` state which is async.
    // So we might need to modify `ask` to accept an optional parameter.
  };

  const runtime = useExternalStoreRuntime({
    isRunning: loading,
    messages: chat,
    convertMessage,
    onNew,
  });

  return runtime;
}
