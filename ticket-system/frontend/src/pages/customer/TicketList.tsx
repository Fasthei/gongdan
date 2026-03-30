import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Typography, Card, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import dayjs from 'dayjs';

const { Title } = Typography;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING:       { label: '待受理', color: 'default' },
  ACCEPTED:      { label: '已受理', color: 'processing' },
  IN_PROGRESS:   { label: '处理中', color: 'blue' },
  PENDING_CLOSE: { label: '待关闭审批', color: 'warning' },
  CLOSED:        { label: '已关闭', color: 'success' },
};

export default function CustomerTicketList() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const navigate = useNavigate();

  const fetchTickets = async (p = 1, status?: string) => {
    setLoading(true);
    try {
      const params: any = { page: p, pageSize: 20 };
      if (status) params.status = status;
      const { data } = await api.get('/tickets', { params });
      setTickets(data.tickets);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTickets(page, statusFilter); }, [page, statusFilter]);

  const columns = [
    { title: '工单编号', dataIndex: 'ticketNumber', key: 'ticketNumber', width: 160 },
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
    { title: '问题描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag>,
    },
    {
      title: '负责工程师', key: 'engineer', width: 120,
      render: (_: any, r: any) => r.assignedEngineer ? `${r.assignedEngineer.username} (${r.assignedEngineer.level})` : '-',
    },
    {
      title: 'SLA 截止', dataIndex: 'slaDeadline', key: 'slaDeadline', width: 160,
      render: (d: string) => {
        const isOverdue = dayjs(d).isBefore(dayjs());
        return <span style={{ color: isOverdue ? '#ff4d4f' : undefined }}>{dayjs(d).format('MM-DD HH:mm')}</span>;
      },
    },
    {
      title: '操作', key: 'action', width: 80,
      render: (_: any, r: any) => <Button type="link" onClick={() => navigate(`/tickets/${r.id}`)}>查看</Button>,
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }}>
      <Card>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0 }}>我的工单</Title>
          <Space>
            <Select placeholder="筛选状态" allowClear style={{ width: 140 }} onChange={setStatusFilter}>
              {Object.entries(STATUS_MAP).map(([k, v]) => (
                <Select.Option key={k} value={k}>{v.label}</Select.Option>
              ))}
            </Select>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tickets/new')}>
              提交工单
            </Button>
          </Space>
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tickets}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        />
      </Card>
    </div>
  );
}
