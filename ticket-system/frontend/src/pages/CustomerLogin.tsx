import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';

const { Title, Text } = Typography;

export default function CustomerLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bgUrl, setBgUrl] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    api.get('/public/bing-background')
      .then(({ data }) => {
        if (active) setBgUrl(data?.imageUrl || '');
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const onFinish = async ({ customerCode }: { customerCode: string }) => {
    setLoading(true);
    setError('');
    try {
      if (!navigator.onLine) throw new Error(t('common.networkError'));
      let data: any;
      try {
        const res = await api.post('/auth/customer-login', { customerCode }, { timeout: 8000 });
        data = res.data;
      } catch (e: any) {
        const code = e?.code;
        const networkLike = !e?.response || code === 'ECONNABORTED';
        if (!networkLike) throw e;
        const retryRes = await api.post('/auth/customer-login', { customerCode }, { timeout: 8000 });
        data = retryRes.data;
      }
      login(data.accessToken, data.refreshToken, data.user);
      navigate('/tickets');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || t('login.customerCodeInvalid'));
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
          <Title level={3} style={{ margin: 0 }}>{t('login.systemTitle')}</Title>
          <Text type="secondary">{t('login.customerLogin')}</Text>
        </div>
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item
            name="customerCode"
            label={t('login.customerCode')}
            rules={[{ required: true, message: t('login.enterCustomerCode') }]}
          >
            <Input placeholder={t('login.customerCodePlaceholder')} size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              {t('common.login')}
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/staff/login">{t('login.staffLoginLink')}</Link>
          <span style={{ margin: '0 8px', color: '#d9d9d9' }}>|</span>
          <Link to="/service-content">{t('login.viewStatusBoard')}</Link>
          <div style={{ marginTop: 8 }}><LanguageSwitcher /></div>
        </div>
      </Card>
    </div>
  );
}
