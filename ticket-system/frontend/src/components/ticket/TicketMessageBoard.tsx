import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Card, Input, Space, Tag, Typography, message, Upload } from 'antd';
import { DeleteOutlined, SendOutlined, UserOutlined, UploadOutlined, PaperClipOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const { Text } = Typography;
const { TextArea } = Input;

const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  CUSTOMER: { label: '客户', color: '#1677ff' },
  ENGINEER: { label: '工程师', color: '#52c41a' },
  OPERATOR: { label: '运营', color: '#fa8c16' },
};

interface Props {
  ticketId: string;
  ticketStatus?: string;
}

export default function TicketMessageBoard({ ticketId, ticketStatus }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/tickets/' + ticketId + '/messages')
      .then(({ data }) => setMessages(data))
      .catch(() => {});
  }, [ticketId]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() && attachmentUrls.length === 0) return;
    setLoading(true);
    try {
      const { data } = await api.post('/tickets/' + ticketId + '/messages', {
        content: input.trim() || '（附件）',
        attachmentUrls,
      });
      setMessages((prev) => [...prev, data]);
      setInput('');
      setAttachmentUrls([]);
    } catch (err: any) {
      message.error(err.response?.data?.message || '留言失败');
    } finally {
      setLoading(false);
    }
  };

  const remove = async (msgId: string) => {
    try {
      await api.delete('/tickets/messages/' + msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const canSend = !(ticketStatus === 'CLOSED' && user?.role === 'CUSTOMER');

  const handleUpload = async (file: File) => {
    try {
      const { data } = await api.post('/attachments/sas-token', { fileName: file.name });
      await fetch(data.sasUrl, { method: 'PUT', body: file, headers: { 'x-ms-blob-type': 'BlockBlob' } });
      const url = data.sasUrl.split('?')[0];
      setAttachmentUrls((prev) => [...prev, url].slice(0, 5));
      message.success(`${file.name} 上传成功`);
    } catch (err: any) {
      message.error(err?.response?.data?.message || `${file.name} 上传失败`);
    }
    return false;
  };

  return (
    <Card bordered={false} title="工单留言板" style={{ marginTop: 16 }}>
      <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 12 }}>
        {messages.length === 0 ? (
          <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: '24px 0' }}>
            暂无留言，率先发言吧
          </Text>
        ) : (
          messages.map((msg: any) => {
            const rl = ROLE_LABEL[msg.authorRole] || { label: msg.authorRole, color: '#999' };
            const isMine = msg.authorId === user?.id;
            const canDelete = isMine || user?.role === 'ADMIN' || user?.role === 'OPERATOR';
            return (
              <div key={msg.id} style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: rl.color, flexShrink: 0 }} />
                <div style={{ flex: 1, background: '#f6f8fb', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Space size={4}>
                      <Tag color={rl.color} style={{ margin: 0 }}>{rl.label}</Tag>
                      <Text style={{ fontSize: 12, color: '#666' }}>{dayjs(msg.createdAt).format('MM-DD HH:mm')}</Text>
                    </Space>
                    {canDelete && (
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger onClick={() => remove(msg.id)} />
                    )}
                  </div>
                  <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</Text>
                  {Array.isArray(msg.attachmentUrls) && msg.attachmentUrls.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Space direction="vertical" size={4}>
                        {msg.attachmentUrls.map((url: string) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer">
                            <PaperClipOutlined /> 附件
                          </a>
                        ))}
                      </Space>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={msgEndRef} />
      </div>
      {canSend ? (
        <>
          <Space style={{ marginBottom: 8 }}>
            <Upload beforeUpload={handleUpload} showUploadList={false} multiple>
              <Button icon={<UploadOutlined />}>上传附件</Button>
            </Upload>
            {attachmentUrls.length > 0 && <Text type="secondary">已上传 {attachmentUrls.length} 个附件</Text>}
          </Space>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Enter 发送，Shift+Enter 换行"
              autoSize={{ minRows: 1, maxRows: 4 }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={send} />
          </Space.Compact>
        </>
      ) : (
        <Text type="secondary">工单已关闭，客户无法继续留言</Text>
      )}
    </Card>
  );
}
