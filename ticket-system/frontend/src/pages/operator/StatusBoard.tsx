import React, { useEffect, useState } from 'react';
import { Card, Alert, Spin, Typography, Tag, Descriptions, Button, Row, Col, Statistic, Table, Space } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, ClockCircleOutlined, LineChartOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export default function StatusBoard() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/status/public-dashboard');
      setStatus(data);
    } catch {
      setError('无法获取统计与服务看板数据');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>服务状态看板</Title>
        <Button icon={<ReloadOutlined />} onClick={fetchStatus} loading={loading} size="small">刷新</Button>
      </div>

      {error && <Alert message={error} type="warning" showIcon style={{ marginBottom: 16 }} />}

      <Spin spinning={loading}>
        {status ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic
                    title="在线工程师"
                    value={status.summary?.engineersOnline || 0}
                    suffix={`/ ${status.summary?.engineersTotal || 0}`}
                    prefix={<CheckCircleOutlined />}
                  />
                  <Text type="secondary">在线率 {(Number(status.summary?.onlineRate || 0) * 100).toFixed(1)}%</Text>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic
                    title="处理中工单"
                    value={status.summary?.totalActiveTickets || 0}
                    prefix={<ClockCircleOutlined />}
                  />
                  <Text type="secondary">状态含 ACCEPTED / IN_PROGRESS / PENDING_CLOSE</Text>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic
                    title="工程师日均处理（近7天）"
                    value={status.summary?.avgPerEngineerPerDay7d || 0}
                    precision={2}
                    prefix={<LineChartOutlined />}
                  />
                  <Text type="secondary">基于 CLOSED 工单统计</Text>
                </Card>
              </Col>
            </Row>

            <Card title="外部平台服务状态">
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="平台接口">
                  <a href="http://20.191.156.160/status/api" target="_blank" rel="noreferrer">
                    http://20.191.156.160/status/api
                  </a>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  {status.external?.data?.status === 'ok' || status.external?.data?.status === 'healthy'
                    ? <Tag color="success">正常</Tag>
                    : status.external?.data?.status === 'unknown'
                    ? <Tag color="default">未知</Tag>
                    : <Tag color="error">异常</Tag>
                  }
                </Descriptions.Item>
                {status.external?.data?.message && (
                  <Descriptions.Item label="说明">{status.external.data.message}</Descriptions.Item>
                )}
                <Descriptions.Item label="最后更新">
                  {status.external?.lastFetchAt ? dayjs(status.external.lastFetchAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="数据是否过期">
                  {status.external?.isStale ? <Tag color="warning">已过期</Tag> : <Tag color="success">最新</Tag>}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="工程师在线与处理明细">
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                dataSource={status.engineers || []}
                columns={[
                  { title: '工程师', dataIndex: 'username', width: 140 },
                  { title: '等级', dataIndex: 'level', width: 80 },
                  {
                    title: '在线',
                    dataIndex: 'isOnline',
                    width: 80,
                    render: (v: boolean) => (v ? <Tag color="success">在线</Tag> : <Tag>离线</Tag>),
                  },
                  { title: '处理中', dataIndex: 'activeTicketCount', width: 90 },
                  { title: '近7天关闭', dataIndex: 'closed7d', width: 110 },
                  { title: '日均', dataIndex: 'avgPerDay7d', width: 90 },
                  {
                    title: '当前工单',
                    key: 'tickets',
                    render: (_: any, r: any) =>
                      Array.isArray(r.currentTickets) && r.currentTickets.length > 0 ? (
                        <Space direction="vertical" size={2}>
                          {r.currentTickets.slice(0, 3).map((t: any) => (
                            <Text key={t.id} style={{ fontSize: 12 }}>
                              {t.ticketNumber} · {t.status} · {t.customerName || t.customerCode || '-'}
                            </Text>
                          ))}
                          {r.currentTickets.length > 3 ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>还有 {r.currentTickets.length - 3} 个…</Text>
                          ) : null}
                        </Space>
                      ) : (
                        <Text type="secondary">-</Text>
                      ),
                  },
                ]}
              />
            </Card>

            {status.external?.data && Object.keys(status.external.data).length > 0 && (
              <Card size="small" title="外部平台原始数据">
                <pre style={{ fontSize: 12, margin: 0, overflow: 'auto' }}>
                  {JSON.stringify(status.external.data, null, 2)}
                </pre>
              </Card>
            )}
          </Space>
        ) : !loading && (
          <Alert message="暂无状态数据，请点击刷新" type="info" showIcon />
        )}
      </Spin>
    </div>
  );
}
