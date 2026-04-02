import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu, Input, Button, Typography, Space, Avatar, ConfigProvider, theme, Tag } from 'antd';
import {
  MenuOutlined, PlusOutlined, SearchOutlined, StarOutlined, FolderOutlined,
  SettingOutlined, SendOutlined, SlidersOutlined, DatabaseOutlined, DownOutlined,
  UserOutlined, RobotOutlined, EditOutlined, MessageOutlined
} from '@ant-design/icons';
import { useStream } from '@langchain/react';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../../contexts/AuthContext';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

// Gemini Dark Theme colors
const bgColor = '#000000';
const sidebarBg = '#1e1f20';
const inputBg = '#282a2c';
const textColor = '#e3e3e3';

export default function KnowledgeBaseChat() {
  const { user } = useAuth();
  const apiUrl = import.meta.env.VITE_KB_CHAT_API_ORIGIN || 'https://aichatgongdan-dna6ghavchd9h6e0.eastasia-01.azurewebsites.net';
  
  const stream = useStream({
    apiUrl,
    assistantId: 'kb-chat-agent',
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream.messages]);

  const handleSend = () => {
    if (!input.trim() || stream.isLoading) return;
    stream.submit({ messages: [{ type: "human", content: input }] });
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getTextContent = (msg: any) => {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map((c: any) => c.text || '').join('');
    }
    return '';
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorBgBase: bgColor, colorTextBase: textColor, colorBorder: '#3c4043' } }}>
      <Layout style={{ height: '100vh', display: 'flex', flexDirection: 'row', overflow: 'hidden', background: bgColor }}>
        <Sider width={280} style={{ background: sidebarBg, padding: '16px 12px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, padding: '0 12px' }}>
            <Button type="text" icon={<MenuOutlined />} style={{ color: '#e3e3e3', marginRight: 16 }} />
            <span style={{ fontSize: 18, fontWeight: 500, color: '#fff' }}>Gemini Enterprise <Tag color="blue" style={{ borderRadius: 12, marginLeft: 8, background: '#1c2b41', color: '#a8c7fa', border: 'none' }}>Plus</Tag></span>
          </div>

          <Button type="text" icon={<EditOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', marginBottom: 8, height: 40, borderRadius: 20 }}>
            New chat
          </Button>
          <Button type="text" icon={<SearchOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', marginBottom: 8, height: 40, borderRadius: 20 }}>
            Search
          </Button>
          <Button type="text" icon={<StarOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', marginBottom: 8, height: 40, borderRadius: 20 }}>
            Starred
          </Button>
          <Button type="text" icon={<FolderOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', marginBottom: 24, height: 40, borderRadius: 20 }}>
            Library
          </Button>

          <div style={{ padding: '0 12px', fontSize: 12, color: '#a0a0a0', marginBottom: 8, fontWeight: 600 }}>Projects</div>
          <Button type="text" icon={<PlusOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', marginBottom: 24, height: 40, borderRadius: 20 }}>
            New project
          </Button>

          <div style={{ padding: '0 12px', fontSize: 12, color: '#a0a0a0', marginBottom: 8, fontWeight: 600 }}>Agents</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Button type="text" style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20 }}>
              <Space><Avatar size="small" src="https://api.dicebear.com/7.x/shapes/svg?seed=1" /> Deep Research</Space>
            </Button>
            <Button type="text" style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20 }}>
              <Space><Avatar size="small" src="https://api.dicebear.com/7.x/shapes/svg?seed=2" /> Idea Generation <Tag color="blue" style={{ borderRadius: 10, scale: 0.8, background: '#1c2b41', color: '#a8c7fa', border: 'none' }}>Preview</Tag></Space>
            </Button>
            <Button type="text" style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20 }}>
              <Space><Avatar size="small" src="https://api.dicebear.com/7.x/shapes/svg?seed=3" /> NotebookLM</Space>
            </Button>
            <Button type="text" icon={<PlusOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20, marginTop: 8 }}>
              New agent
            </Button>

            <div style={{ padding: '0 12px', fontSize: 12, color: '#a0a0a0', marginTop: 24, marginBottom: 8, fontWeight: 600 }}>Chats</div>
            <Button type="text" icon={<MessageOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>A3 Ultra H200 GPU purchase</Button>
            <Button type="text" icon={<MessageOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20 }}>GCP Flex Commit</Button>
            <Button type="text" icon={<MessageOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', width: '100%', height: 40, borderRadius: 20 }}>Vertex AI logging</Button>
          </div>

          <Button type="text" icon={<SettingOutlined />} style={{ color: '#e3e3e3', justifyContent: 'flex-start', height: 40, borderRadius: 20, marginTop: 'auto' }}>
            Settings & help
          </Button>
        </Sider>

        <Content style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', flex: 1, background: bgColor }}>
          <div style={{ position: 'absolute', top: 16, right: 24, zIndex: 10 }}>
            <Avatar icon={<UserOutlined />} src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '40px 15%', display: 'flex', flexDirection: 'column' }}>
            {stream.messages.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 800 }}>
                <Title level={2} style={{ color: '#fff', fontWeight: 400 }}>
                  <span style={{ color: '#a8c7fa' }}>✦</span> Hello, {user?.username || 'Yuan'}
                </Title>
                <Title level={1} style={{ color: '#fff', fontSize: 48, fontWeight: 400, marginTop: 0 }}>
                  Let's get some work done!
                </Title>
              </div>
            ) : (
              <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', paddingBottom: 120 }}>
                {stream.messages.map((msg, i) => {
                  if (HumanMessage.isInstance(msg)) {
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
                        <div style={{ background: '#282a2c', padding: '12px 20px', borderRadius: '24px 24px 4px 24px', maxWidth: '80%', color: '#e3e3e3', fontSize: 16 }}>
                          {getTextContent(msg)}
                        </div>
                      </div>
                    );
                  }
                  if (AIMessage.isInstance(msg)) {
                    return (
                      <div key={i} style={{ display: 'flex', marginBottom: 32, alignItems: 'flex-start' }}>
                        <Avatar icon={<RobotOutlined />} style={{ background: '#a8c7fa', color: '#000', marginRight: 16, flexShrink: 0 }} />
                        <div style={{ color: '#e3e3e3', fontSize: 16, lineHeight: 1.6, flex: 1, overflow: 'hidden' }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {getTextContent(msg) || '...'}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div style={{ padding: '0 15%', paddingBottom: 32, position: 'absolute', bottom: 0, width: '100%', background: 'linear-gradient(to top, #000000 70%, transparent)' }}>
            <div style={{ maxWidth: 800, margin: '0 auto', background: '#1e1f20', borderRadius: 32, padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything, search your data, @mention or /tools"
                autoSize={{ minRows: 1, maxRows: 6 }}
                style={{ background: 'transparent', color: '#e3e3e3', fontSize: 16, boxShadow: 'none', border: 'none', resize: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <Space size={16}>
                  <Button type="text" icon={<PlusOutlined />} style={{ color: '#e3e3e3', borderRadius: '50%' }} />
                  <Button type="text" icon={<SlidersOutlined />} style={{ color: '#e3e3e3', borderRadius: '50%' }} />
                  <Button type="text" icon={<DatabaseOutlined />} style={{ color: '#e3e3e3', borderRadius: '50%' }} />
                </Space>
                <Space>
                  <Button type="text" style={{ color: '#a8c7fa', background: '#282a2c', borderRadius: 20 }}>
                    3 Flash <DownOutlined style={{ fontSize: 10 }} />
                  </Button>
                  <Button 
                    type={input.trim() ? "primary" : "text"} 
                    icon={<SendOutlined />} 
                    onClick={handleSend}
                    loading={stream.isLoading}
                    style={{ 
                      borderRadius: '50%', 
                      background: input.trim() ? '#a8c7fa' : 'transparent', 
                      color: input.trim() ? '#000' : '#e3e3e3',
                      borderColor: 'transparent'
                    }} 
                  />
                </Space>
              </div>
            </div>
          </div>
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
