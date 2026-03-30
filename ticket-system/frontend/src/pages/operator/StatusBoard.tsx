import React, { useEffect, useState } from 'react';
import { Card, Alert, Spin, Typography, Tag, Descriptions, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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
      const { data } = await api.get('/status/external');
      setStatus(data);
    } catch {
      setError('无法获取外部服务状态');
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
          <Card title="外部服务状态">
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="状态">
                {status.data?.status === 'ok' || status.data?.status === 'healthy'
                  ? <Tag color="success">正常</Tag>
                  : status.data?.status === 'unknown'
                  ? <Tag color="default">未知</Tag>
                  : <Tag color="error">异常</Tag>
                }
              </Descriptions.Item>
              {status.data?.message && (
                <Descriptions.Item label="说明">{status.data.message}</Descriptions.Item>
              )}
              <Descriptions.Item label="最后更新">
                {status.lastFetchAt ? dayjs(status.lastFetchAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="数据是否过期">
                {status.isStale ? <Tag color="warning">已过期</Tag> : <Tag color="success">最新</Tag>}
              </Descriptions.Item>
            </Descriptions>

            {status.data && Object.keys(status.data).length > 0 && (
              <Card size="small" title="原始数据" style={{ marginTop: 16 }}>
                <pre style={{ fontSize: 12, margin: 0, overflow: 'auto' }}>
                  {JSON.stringify(status.data, null, 2)}
                </pre>
              </Card>
            )}
          </Card>
        ) : !loading && (
          <Alert message="暂无状态数据，请点击刷新" type="info" showIcon />
        )}
      </Spin>
    </div>
  );
}
