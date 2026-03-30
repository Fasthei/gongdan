import React, { useMemo, useState } from 'react';
import { Card, Input, Button, Typography, Space, message, List, Tag } from 'antd';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const { TextArea } = Input;
const { Title, Text } = Typography;

type ChatItem = { role: 'user' | 'assistant'; content: string };

export default function KnowledgeBaseChat() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const [customerCode, setCustomerCode] = useState('');
  const [verifiedCode, setVerifiedCode] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [sources, setSources] = useState<any[]>([]);

  const canAsk = useMemo(() => {
    if (isCustomer) return !!verifiedCode;
    return true;
  }, [isCustomer, verifiedCode]);

  const verifyCode = () => {
    if (!customerCode.trim()) return message.warning('请先输入客户编号');
    setVerifiedCode(customerCode.trim());
    message.success('客户编号已确认，可以开始知识库对话');
  };

  const ask = async () => {
    if (!question.trim()) return;
    if (!canAsk) return message.warning('客户请先输入并确认客户编号');

    const userMsg: ChatItem = { role: 'user', content: question.trim() };
    const nextChat = [...chat, userMsg];
    setChat(nextChat);
    setQuestion('');
    setLoading(true);

    try {
      const { data } = await api.post('/knowledge-base/smart-query', {
        question: userMsg.content,
        topK: 5,
        history: nextChat.slice(-10),
        ...(isCustomer ? { customerCode: verifiedCode } : {}),
      });
      const answer = data?.answer || '未获取到答案';
      setChat((prev) => [...prev, { role: 'assistant', content: answer }]);
      setSources(Array.isArray(data?.sources) ? data.sources : []);
    } catch (err: any) {
      message.error(err.response?.data?.message || '知识库对话失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Title level={4}>知识库对话</Title>
      {isCustomer && (
        <Space style={{ marginBottom: 12 }}>
          <Input
            value={customerCode}
            onChange={(e) => setCustomerCode(e.target.value)}
            placeholder="请输入客户编号（必填）"
            style={{ width: 280 }}
          />
          <Button onClick={verifyCode}>确认编号</Button>
          {verifiedCode && <Tag color="green">已确认：{verifiedCode}</Tag>}
        </Space>
      )}

      <List
        bordered
        dataSource={chat}
        locale={{ emptyText: '开始提问，进行知识库对话' }}
        renderItem={(item) => (
          <List.Item>
            <Text strong={item.role === 'user'}>{item.role === 'user' ? '你' : '知识库'}：</Text>
            <Text>{item.content}</Text>
          </List.Item>
        )}
        style={{ marginBottom: 12, maxHeight: 360, overflow: 'auto' }}
      />

      <TextArea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="输入问题后发送..."
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" onClick={ask} loading={loading} disabled={!canAsk}>
          发送
        </Button>
        <Button onClick={() => { setChat([]); setSources([]); }}>清空会话</Button>
      </Space>

      {sources.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text strong>参考资料：</Text>
          <List
            size="small"
            dataSource={sources}
            renderItem={(s: any) => (
              <List.Item>
                <Text>{s.title || '未命名资料'} {s.platform ? `(${s.platform})` : ''}</Text>
              </List.Item>
            )}
          />
        </div>
      )}
    </Card>
  );
}
