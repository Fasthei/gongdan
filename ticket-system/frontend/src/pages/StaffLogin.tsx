import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';

const { Title, Text } = Typography;

export default function StaffLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bgUrl, setBgUrl] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api.get('/public/bing-background')
      .then(({ data }) => {
        if (active) setBgUrl(data?.imageUrl || '');
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const onFinish = async ({ username, password }: { username: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/staff-login', { username, password });
      login(data.accessToken, data.refreshToken, data.user);
      const role = data.user?.role;
      if (role === 'OPERATOR') navigate('/operator');
      else navigate('/engineer');
    } catch (err: any) {
      setError(err.response?.data?.message || '用户名或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bgUrl
          ? `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url(${bgUrl}) center/cover no-repeat`
          : '#f0f2f5',
      }}
    >
      <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ margin: 0 }}>技术支持工单系统</Title>
          <Text type="secondary">运营 / 技术人员登录</Text>
        </div>
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input placeholder="请输入用户名" size="large" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              登录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/login">客户登录</Link>
          <span style={{ margin: '0 8px', color: '#d9d9d9' }}>|</span>
          <Link to="/status-board">查看服务看板（免登录）</Link>
        </div>
      </Card>
    </div>
  );
}
