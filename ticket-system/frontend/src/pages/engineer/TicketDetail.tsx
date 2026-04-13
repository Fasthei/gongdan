import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, Button, Space, Spin, Alert, Typography, Divider, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import dayjs from 'dayjs';
import TicketMessageBoard from '../../components/ticket/TicketMessageBoard';

const { Title, Text, Paragraph } = Typography;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING:       { label: '待受理', color: 'default' },
  ACCEPTED:      { label: '已受理', color: 'processing' },
  IN_PROGRESS:   { label: '处理中', color: 'blue' },
  PENDING_CLOSE: { label: '待关闭审批', color: 'warning' },
  CLOSED:        { label: '已关闭', color: 'success' },
};
export default function EngineerTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get(`/tickets/${id}`).then(({ data }) => {
      setTicket(data.ticket || data);
    }).finally(() => setLoading(false));
  }, [id]);

  const handleStatusUpdate = async (newStatus: string) => {
    try {
      await api.put(`/tickets/${id}/status`, { status: newStatus });
      message.success('状态已更新');
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket || data);
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const handleCloseRequest = async () => {
    try {
      await api.put(`/tickets/${id}/close-request`);
      message.success('已申请关闭，等待运营审批');
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket || data);
    } catch (err: any) {
      message.error(err.response?.data?.message || '申请失败');
    }
  };

  const handleSelfAssign = async () => {
    try {
      await api.put(`/tickets/${id}/self-assign`);
      message.success('接单成功，工单已受理');
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket || data);
    } catch (err: any) {
      message.error(err.response?.data?.message || '接单失败');
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!ticket) return <Alert message="工单不存在" type="error" style={{ margin: 24 }} />;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <Space style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/engineer')}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>{ticket.ticketNumber}</Title>
        <Tag color={STATUS_MAP[ticket.status]?.color}>{STATUS_MAP[ticket.status]?.label}</Tag>
      </Space>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        <div>
          <Card title="工单详情" bordered={false} style={{ marginBottom: 24 }}>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="平台">{ticket.platform}</Descriptions.Item>
              <Descriptions.Item label="售前/售后">
                {ticket.assistancePhase === 'PRESALES' ? '售前' : '售后'}
              </Descriptions.Item>
              <Descriptions.Item label="模型">{ticket.modelUsed}</Descriptions.Item>
              <Descriptions.Item label="账号信息" span={2}>{ticket.accountInfo}</Descriptions.Item>
              <Descriptions.Item label="问题描述" span={2}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ticket.description}</pre>
              </Descriptions.Item>
              <Descriptions.Item label="请求示例" span={2}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{ticket.requestExample}</pre>
              </Descriptions.Item>
              {ticket.framework && <Descriptions.Item label="框架">{ticket.framework}</Descriptions.Item>}
              {ticket.networkEnv && <Descriptions.Item label="网络">{ticket.networkEnv}</Descriptions.Item>}
              {ticket.contactInfo && <Descriptions.Item label="联系方式">{ticket.contactInfo}</Descriptions.Item>}
              <Descriptions.Item label="SLO 截止">
                {dayjs(ticket.slaDeadline).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="提交时间">
                {dayjs(ticket.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="操作" bordered={false}>
            <Space>
              {ticket.status === 'PENDING' && (
                <Button type="primary" onClick={handleSelfAssign}>接单</Button>
              )}
              {ticket.status === 'ACCEPTED' && (
                <Button type="primary" onClick={() => handleStatusUpdate('IN_PROGRESS')}>开始处理</Button>
              )}
              {ticket.status === 'IN_PROGRESS' && (
                <Button danger onClick={handleCloseRequest}>申请关闭</Button>
              )}
            </Space>
            {ticket.status === 'CLOSED' && <Text type="secondary">工单已关闭</Text>}
            {ticket.status === 'PENDING_CLOSE' && <Text type="warning">等待运营审批关闭</Text>}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TicketMessageBoard ticketId={ticket.id} ticketStatus={ticket.status} />
        </div>
      </div>
    </div>
  );
}
