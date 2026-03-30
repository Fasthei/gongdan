import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Select, Space, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import dayjs from 'dayjs';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING:       { label: '待受理', color: 'default' },
  ACCEPTED:      { label: '已受理', color: 'processing' },
  IN_PROGRESS:   { label: '处理中', color: 'blue' },
  PENDING_CLOSE: { label: '待关闭审批', color: 'warning' },
  CLOSED:        { label: '已关闭', color: 'success' },
};

const NEXT_STATUS: Record<string, string> = {
  ACCEPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'PENDING_CLOSE',
};

export default function EngineerTicketList() {
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

  const handleStatusUpdate = async (ticketId: string, newStatus: string) => {
    try {
      await api.put(`/tickets/${ticketId}/status`, { status: newStatus });
      message.success('状态已更新');
      fetchTickets(page, statusFilter);
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const handleCloseRequest = async (ticketId: string) => {
    try {
      await api.put(`/tickets/${ticketId}/close-request`);
      message.success('已申请关闭，等待运营审批');
      fetchTickets(page, statusFilter);
    } catch (err: any) {
      message.error(err.response?.data?.message || '申请失败');
    }
  };

  const columns = [
    { title: '工单编号', dataIndex: 'ticketNumber', width: 150 },
    { title: '客户', key: 'customer', width: 120, render: (_: any, r: any) => r.customer?.name || '-' },
    { title: '平台', dataIndex: 'platform', width: 80 },
    { title: '问题描述', dataIndex: 'description', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag>,
    },
    {
      title: 'SLA', dataIndex: 'slaDeadline', width: 120,
      render: (d: string) => {
        const over = dayjs(d).isBefore(dayjs());
        return <span style={{ color: over ? '#ff4d4f' : undefined }}>{dayjs(d).format('MM-DD HH:mm')}</span>;
      },
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => navigate(`/engineer/tickets/${r.id}`)}>详情</Button>
          {NEXT_STATUS[r.status] && (
            <Button size="small" type="primary" onClick={() => handleStatusUpdate(r.id, NEXT_STATUS[r.status])}>
              {r.status === 'ACCEPTED' ? '开始处理' : '申请关闭'}
            </Button>
          )}
          {r.status === 'IN_PROGRESS' && (
            <Button size="small" danger onClick={() => handleCloseRequest(r.id)}>申请关闭</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select placeholder="筛选状态" allowClear style={{ width: 140 }} onChange={setStatusFilter}>
          {Object.entries(STATUS_MAP).map(([k, v]) => (
            <Select.Option key={k} value={k}>{v.label}</Select.Option>
          ))}
        </Select>
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={tickets}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        size="small"
      />
    </>
  );
}
