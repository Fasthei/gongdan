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

export function ChatInputArea({ ctx }: { ctx: KbChatContextType }) {
  const {
    aiSearchDepth,
    ask,
    canAsk,
    chat,
    docAttachments,
    docGenMode,
    getDocKind,
    loading,
    question,
    removeDocAttachment,
    sandboxMode,
    searchMode,
    setAiSearchDepth,
    setDocAttachments,
    setExampleFileList,
    setExampleModalOpen,
    setQuestion,
    setRequestExampleText,
    setSandboxMode,
    setSearchMode,
    toggleDocGenMode,
  } = ctx;

  return (
<>
          {/* Input Area（与上方消息区同属主列，不单独随左侧滚动） */}
          <div style={{ padding: '0 24px 24px', background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 20%)' }}>
            <div style={{ maxWidth: 800, margin: '0 auto', marginLeft: 'calc(50% - 600px + 24px)', '@media (max-width: 1200px)': { marginLeft: 'auto' } } as any}>
              <div style={{ 
                position: 'relative', 
                boxShadow: '0 2px 6px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)', 
                borderRadius: 24,
                background: '#fff',
                padding: '8px 16px',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <TextArea
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="给知识库发送消息..."
                  bordered={false}
                  style={{ resize: 'none', boxShadow: 'none', marginBottom: 36 }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', bottom: 8, left: 16, right: 8, flexWrap: 'wrap', gap: 8 }}>
                  <Space size={8} wrap>
                  <Upload
                    accept=".doc,.docx,.txt,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif"
                    showUploadList={false}
                    multiple
                    beforeUpload={(file) => {
                      const kind = getDocKind(file.name);
                      if (!kind) {
                        message.warning('仅支持 Word/TXT/表格/图片 四类文件');
                        return Upload.LIST_IGNORE;
                      }
                      if (docAttachments.length >= 3) {
                        message.warning('最多上传 3 个文档');
                        return Upload.LIST_IGNORE;
                      }
                      const uid = file.uid;
                      setDocAttachments((prev) => [
                        ...prev,
                        { uid, name: file.name, status: 'uploading', kind, parsedText: '' },
                      ]);
                      const done = (parsedText: string) => {
                        setDocAttachments((prev) =>
                          prev.map((f) => (f.uid === uid ? { ...f, status: 'done', parsedText } : f)),
                        );
                      };
                      const fail = (errMsg: string) => {
                        setDocAttachments((prev) =>
                          prev.map((f) => (f.uid === uid ? { ...f, status: 'error', error: errMsg } : f)),
                        );
                      };
                      if (kind === 'txt' || (kind === 'table' && file.name.toLowerCase().endsWith('.csv'))) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const text = String(reader.result || '');
                          const clipped = text.length > 120000 ? `${text.slice(0, 120000)}\n... [文件内容已截断]` : text;
                          done(`--- 文件: ${file.name} ---\n${clipped}`);
                        };
                        reader.onerror = () => fail('读取失败');
                        reader.readAsText(file as Blob);
                      } else {
                        const kb = Math.max(1, Math.round(file.size / 1024));
                        const note =
                          kind === 'image'
                            ? `--- 图片文件: ${file.name} ---\n[图片已上传，当前仅附带文件元信息，大小 ${kb}KB]`
                            : `--- 文件: ${file.name} ---\n[二进制文档已上传，当前仅附带文件元信息，大小 ${kb}KB]`;
                        done(note);
                      }
                      return false;
                    }}
                  >
                    <Button shape="circle" size="small" icon={<PlusOutlined />} title="上传文档（最多3个）" />
                  </Upload>
                  <Button
                    shape="round"
                    size="small"
                    icon={<GlobalOutlined />}
                    onClick={() => {
                      const next = searchMode === 'hybrid' ? 'internal' : 'hybrid';
                      setSearchMode(next);
                      localStorage.setItem('kb-chat-search-mode', next);
                    }}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: searchMode === 'hybrid' ? '#202124' : '#f1f3f4',
                      color: searchMode === 'hybrid' ? '#fff' : '#5f6368',
                    }}
                  >
                    AI 搜索
                  </Button>
                  {searchMode === 'hybrid' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Button
                        size="small"
                        type={aiSearchDepth === 'fast' ? 'primary' : 'default'}
                        onClick={() => {
                          setAiSearchDepth('fast');
                          localStorage.setItem('kb-ai-search-depth', 'fast');
                        }}
                        style={{
                          borderRadius: 999,
                          border: aiSearchDepth === 'fast' ? '1px solid #1677ff' : '1px solid #d9d9d9',
                          boxShadow: aiSearchDepth === 'fast' ? '0 0 0 1px rgba(22,119,255,0.2)' : 'none',
                        }}
                      >
                        快速搜索
                      </Button>
                      <Button
                        size="small"
                        type={aiSearchDepth === 'deep' ? 'primary' : 'default'}
                        onClick={() => {
                          setAiSearchDepth('deep');
                          localStorage.setItem('kb-ai-search-depth', 'deep');
                        }}
                        style={{
                          borderRadius: 999,
                          border: aiSearchDepth === 'deep' ? '1px solid #1677ff' : '1px solid #d9d9d9',
                          boxShadow: aiSearchDepth === 'deep' ? '0 0 0 1px rgba(22,119,255,0.2)' : 'none',
                        }}
                      >
                        深度搜索
                      </Button>
                    </div>
                  ) : null}
                  <Button
                    shape="round"
                    size="small"
                    icon={<CodeOutlined />}
                    onClick={() => {
                      const next = !sandboxMode;
                      setSandboxMode(next);
                      localStorage.setItem('kb-sandbox-mode', next ? '1' : '0');
                      if (!next) {
                        setRequestExampleText('');
                        setExampleFileList([]);
                      }
                    }}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: sandboxMode ? '#0d47a1' : '#f1f3f4',
                      color: sandboxMode ? '#fff' : '#5f6368',
                    }}
                  >
                    沙盒
                  </Button>
                  <Button
                    shape="round"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={toggleDocGenMode}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: docGenMode ? '#202124' : '#f1f3f4',
                      color: docGenMode ? '#fff' : '#5f6368',
                    }}
                  >
                    文档生成
                  </Button>
                  <Button
                    shape="round"
                    size="small"
                    disabled={!sandboxMode}
                    onClick={() => setExampleModalOpen(true)}
                  >
                    请求示例
                  </Button>
                  </Space>
                  <Button 
                    type="primary" 
                    shape="circle" 
                    icon={<SendOutlined />} 
                    onClick={ask} 
                    loading={loading} 
                    disabled={!question.trim() || !canAsk}
                  />
                </div>
                {docAttachments.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {docAttachments.map((f) => (
                      <Tag
                        key={f.uid}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          removeDocAttachment(f.uid);
                        }}
                        color={f.status === 'done' ? 'blue' : f.status === 'uploading' ? 'processing' : 'error'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {f.status === 'uploading' ? <Spin size="small" /> : null}
                        {f.name}
                        <span style={{ opacity: 0.7 }}>
                          {f.status === 'uploading' ? '加载中' : f.status === 'done' ? '已就绪' : '失败'}
                        </span>
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI 可能会犯错。请核实重要信息。
                </Text>
              </div>
            </div>
          </div>
</>
  );
}
