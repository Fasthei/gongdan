import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button, Typography, Space, message, List, Tag, Spin, Avatar, Modal, Upload, Select, Tooltip } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  RobotOutlined,
  UserOutlined,
  SendOutlined,
  ReloadOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  GlobalOutlined,
  CodeOutlined,
  CopyOutlined,
  UploadOutlined,
  InfoCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../../api/axios';
import { apiUrl } from '../../../config/apiBase';
import { useAuth } from '../../../contexts/AuthContext';

const { TextArea } = Input;
const { Title, Text } = Typography;

/** 与 Postman「Copy as cURL」一致的多行格式；勿加 shebang、set -e、-w 等，避免与真实请求不一致 */
const CURL_EXAMPLE_TEMPLATE = `curl --location 'https://YOUR_RESOURCE.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer <API_KEY>' \\
--data '{
        "messages": [
            {
                "role": "user",
                "content": "你好"
            }
        ],
        "max_completion_tokens": 16384,
        "model": "你的部署名或模型名"
    }'
`;

type ChatItem = { role: 'user' | 'assistant'; content: string; searchMode?: 'internal' | 'hybrid' };
type ThinkRound = {
  id: string;
  question: string;
  think: string;
  searchMode: 'internal' | 'hybrid';
  createdAt: string;
};
type DocAttachment = {
  uid: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  kind: 'word' | 'txt' | 'table' | 'image';
  parsedText: string;
  error?: string;
};

import { ChatSidebar } from './components/ChatSidebar';
import { ChatMessageList } from './components/ChatMessageList';
import { DocWorkspace } from './components/DocWorkspace';
import { ChatRightPanel } from './components/ChatRightPanel';
import { ChatInputArea } from './components/ChatInputArea';
import { SandboxModal } from './components/SandboxModal';
import { useKbChat } from './useKbChat';
import { useAssistantRuntime } from './useAssistantRuntime';
import { AssistantRuntimeProvider } from '@assistant-ui/react';

export default function KnowledgeBaseChat() {
  const ctx = useKbChat();
  const runtime = useAssistantRuntime(ctx);
  const {
    CURL_EXAMPLE_TEMPLATE,
    aiSearchDepth,
    aiSearchStreamText,
    applyDocTemplate,
    ask,
    canAsk,
    chat,
    chatHistoryList,
    customerCode,
    deleteSession,
    docAttachments,
    docEvidenceSummary,
    docGenLoading,
    docGenMode,
    docGenResult,
    exampleFileList,
    exampleModalOpen,
    followUps,
    getDocKind,
    isCustomer,
    llmThinkRef,
    llmThinkText,
    loading,
    markdownComponents,
    messagesRef,
    question,
    removeDocAttachment,
    requestExampleText,
    retrievalStatus,
    runDocGeneration,
    sandboxMode,
    sandboxStatus,
    searchMode,
    selectedTicketIds,
    selectedTickets,
    sessionId,
    setAiSearchDepth,
    setChat,
    setCustomerCode,
    setDocAttachments,
    setExampleFileList,
    setExampleModalOpen,
    setFollowUps,
    setLlmThinkText,
    setQuestion,
    setRequestExampleText,
    setSandboxMode,
    setSearchMode,
    setSelectedTicketIds,
    setSelectedTickets,
    setSessionId,
    setSources,
    setThinkHistory,
    setTicketLoading,
    setWorkspaceText,
    shouldShowThinkPanel,
    sources,
    thinkHistory,
    ticketLoading,
    ticketOptions,
    toggleDocGenMode,
    user,
    verifiedCode,
    verifyCode,
    workspaceText,
    workspaceVisible,
  } = ctx;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', background: '#fff', margin: '0' }}>
        {/* Header */}
      <div style={{ padding: '20px 20px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => window.history.back()} />
          <Title level={5} style={{ margin: 0 }}>知识库对话</Title>
        </Space>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            size="small"
            onClick={() => {
              setChat([]);
              setSources([]);
              setFollowUps([]);
              setLlmThinkText('');
              setThinkHistory([]);
              llmThinkRef.current = '';
              setSessionId('');
              localStorage.removeItem('kb-chat-history');
              localStorage.removeItem('kb-chat-session-id');
            }}
          >
            新会话
          </Button>
        </Space>
      </div>

      {isCustomer && !verifiedCode ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
          <div style={{ background: '#fff', padding: 40, borderRadius: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 24 }}>验证客户身份</Title>
            <Space direction="vertical" size="large" style={{ width: 300 }}>
              <Input
                size="large"
                value={customerCode}
                onChange={(e) => setCustomerCode(e.target.value)}
                placeholder="请输入您的客户编号"
              />
              <Button type="primary" size="large" block onClick={verifyCode}>开始对话</Button>
            </Space>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <ChatSidebar ctx={ctx} />

          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              minHeight: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'row',
                gap: workspaceVisible ? 16 : 24,
                padding: '0 24px',
                minHeight: 0,
                maxWidth: 1200,
                width: '100%',
                margin: '0 auto',
                alignItems: 'stretch',
              }}
            >
              <ChatMessageList ctx={ctx} />
              {workspaceVisible ? <DocWorkspace ctx={ctx} /> : null}
              <ChatRightPanel ctx={ctx} />
            </div>

            <ChatInputArea ctx={ctx} />
          </div>
        </div>
      )}

      <SandboxModal ctx={ctx} />
    </div>
    </AssistantRuntimeProvider>
  );
}
