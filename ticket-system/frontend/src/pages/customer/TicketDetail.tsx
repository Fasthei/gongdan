import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, Button, Steps, Typography, Space, Spin, Alert, Modal, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import dayjs from 'dayjs';
import TicketMessageBoard from '../../components/ticket/TicketMessageBoard';

const { Title } = Typography;

const STATUS_STEPS = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_CLOSE', 'CLOSED'];
const STATUS_LABEL: Record<string, string> = {
  PENDING: '待受理', ACCEPTED: '已受理', IN_PROGRESS: '处理中',
  PENDING_CLOSE: '待关闭审批', CLOSED: '已关闭',
};
const PLATFORM_LABEL: Record<string, string> = { taiji: '太极平台', xm: 'XM 平台', original: '原厂' };

export default function CustomerTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const handleCustomerClose = () => {
    Modal.confirm({
      title: '确认关闭工单',
      content: '关闭后工单将不可再修改，确认关闭吗？',
      okText: '确认关闭',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.put(`/tickets/${id}/customer-close`);
          message.success('工单已关闭');
          const { data } = await api.get(`/tickets/${id}`);
          setTicket(data);
        } catch (err: any) {
          message.error(err.response?.data?.message || '关闭失败，请重试');
        }
      },
    });
  };

  useEffect(() => {
    api.get(`/tickets/${id}`).then(({ data }) => setTicket(data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!ticket) return <Alert message="工单不存在" type="error" style={{ margin: 24 }} />;

  const currentStep = STATUS_STEPS.indexOf(ticket.status);
  const isOverdue = dayjs(ticket.slaDeadline).isBefore(dayjs()) && ticket.status !== 'CLOSED';

  return (
    <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tickets')}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>工单详情 — {ticket.ticketNumber}</Title>
        <Tag color={ticket.status === 'CLOSED' ? 'success' : 'processing'}>{STATUS_LABEL[ticket.status]}</Tag>
        {ticket.status !== 'CLOSED' && (
          <Button danger onClick={handleCustomerClose}>关闭工单</Button>
        )}
      </Space>

      {isOverdue && <Alert message="该工单已超出 SLO 时限，请联系运营催单" type="warning" showIcon style={{ marginBottom: 16 }} />}

      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Steps
          current={currentStep}
          items={STATUS_STEPS.map((s) => ({ title: STATUS_LABEL[s] }))}
          size="small"
        />
      </Card>

      <Card title="工单信息" bordered={false} style={{ marginBottom: 16 }}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="平台">{PLATFORM_LABEL[ticket.platform] || ticket.platform}</Descriptions.Item>
          <Descriptions.Item label="售前/售后">
            {ticket.assistancePhase === 'PRESALES' ? '售前' : '售后'}
          </Descriptions.Item>
          <Descriptions.Item label="使用模型">{ticket.modelUsed}</Descriptions.Item>
          <Descriptions.Item label="账号信息" span={2}>{ticket.accountInfo}</Descriptions.Item>
          <Descriptions.Item label="问题描述" span={2}><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ticket.description}</pre></Descriptions.Item>
          <Descriptions.Item label="请求示例" span={2}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{ticket.requestExample}</pre></Descriptions.Item>
          {ticket.framework && <Descriptions.Item label="框架/应用">{ticket.framework}</Descriptions.Item>}
          {ticket.networkEnv && <Descriptions.Item label="网络环境">{ticket.networkEnv === 'local' ? '本地' : '云上'}</Descriptions.Item>}
          {ticket.contactInfo && <Descriptions.Item label="联系方式">{ticket.contactInfo}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Card title="处理信息" bordered={false}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="负责工程师">
            {ticket.assignedEngineer ? `${ticket.assignedEngineer.username} (${ticket.assignedEngineer.level})` : '待分配'}
          </Descriptions.Item>
          <Descriptions.Item label="SLO 截止">
            <span style={{ color: isOverdue ? '#ff4d4f' : undefined }}>
              {dayjs(ticket.slaDeadline).format('YYYY-MM-DD HH:mm')}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="提交时间">{dayjs(ticket.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
          {ticket.acceptedAt && <Descriptions.Item label="受理时间">{dayjs(ticket.acceptedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
          {ticket.closedAt && <Descriptions.Item label="关闭时间">{dayjs(ticket.closedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <TicketMessageBoard ticketId={ticket.id} ticketStatus={ticket.status} />
    </div>
  );
}
