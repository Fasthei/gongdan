import React from 'react';
import { Button, Typography, Space, List, Tag, Spin, Avatar, Modal, Upload, Select, Tooltip, Input, message } from 'antd';
import { 
  RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined, ArrowLeftOutlined, 
  PlusOutlined, GlobalOutlined, CodeOutlined, CopyOutlined, UploadOutlined, 
  InfoCircleOutlined, DownloadOutlined, DeleteOutlined 
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { KbChatContextType } from '../useKbChat';

const { Title, Text } = Typography;
const { TextArea } = Input;

export function ChatSidebar({ ctx }: { ctx: KbChatContextType }) {
  const {
    chat,
    chatHistoryList,
    deleteSession,
    llmThinkRef,
    sessionId,
    setChat,
    setFollowUps,
    setLlmThinkText,
    setSessionId,
    setSources,
    setThinkHistory,
  } = ctx;

  return (
<>
          {/* Left Sidebar for Chat History */}
          <div style={{ width: 260, borderRight: '1px solid #f0f0f0', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
              <Button 
                type="dashed" 
                block 
                icon={<PlusOutlined />} 
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
                开启新对话
              </Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {chatHistoryList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#bfbfbf', fontSize: 13 }}>暂无历史对话</div>
              ) : (
                <List
                  dataSource={chatHistoryList}
                  renderItem={(item: any) => (
                    <List.Item 
                      style={{ 
                        padding: '10px 12px', 
                        cursor: 'pointer', 
                        borderRadius: 8,
                        background: sessionId === item.id ? '#e6f4ff' : 'transparent',
                        borderBottom: 'none',
                        marginBottom: 4
                      }}
                      onClick={() => {
                        setSessionId(item.id);
                        localStorage.setItem('kb-chat-session-id', item.id);
                      }}
                    >
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ overflow: 'hidden', flex: 1 }}>
                          <Text ellipsis style={{ display: 'block', fontSize: 14, color: sessionId === item.id ? '#1677ff' : '#333' }}>
                            {item.title || '新对话'}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(item.updatedAt).toLocaleDateString()}
                          </Text>
                        </div>
                        <Button 
                          type="text" 
                          size="small" 
                          icon={<DeleteOutlined />} 
                          onClick={(e) => deleteSession(e, item.id)}
                          style={{ color: '#ff4d4f', flexShrink: 0 }}
                        />
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </div>
</>
  );
}
