import { useExternalStoreRuntime, ThreadMessageLike, AppendMessage } from '@assistant-ui/react';
import { useCallback } from 'react';
import { KbChatContextType } from './useKbChat';

export function useAssistantRuntime(ctx: KbChatContextType) {
  const { chat, loading, ask, setQuestion } = ctx;

  const convertMessage = useCallback((msg: any): ThreadMessageLike => {
    return {
      role: msg.role,
      content: [{ type: 'text', text: msg.content || '' }],
    };
  }, []);

  const onNew = async (message: AppendMessage) => {
    if (message.content[0]?.type !== 'text') return;
    const text = message.content[0].text;
    
    // We need to set the question and then call ask.
    // However, ask() reads from the `question` state which is updated asynchronously.
    // To fix this without changing useKbChat too much, we can just call setQuestion 
    // and let a useEffect in the component call ask(), or we can pass the text to ask().
    // For now, let's assume we modify useKbChat's ask to accept an optional parameter.
    
    // Actually, we can just patch useKbChat to accept an optional `overrideQuestion` parameter.
    await ask(text);
  };

  const runtime = useExternalStoreRuntime({
    isRunning: loading,
    messages: chat,
    convertMessage,
    onNew,
  });

  return runtime;
}
