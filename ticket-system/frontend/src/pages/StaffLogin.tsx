import React, { useEffect, useState } from 'react';
import { Card, Button, Alert, Typography, Space } from 'antd';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';

const { Title, Text } = Typography;

/**
 * Staff 登录页：统一走 Casdoor SSO。
 * 流程：点击按钮 → 后端返回授权 URL → 浏览器跳转 Casdoor →
 *      Casdoor 回调 /staff/auth/callback → AuthCallback 页面完成 token 换取。
 */
export default function StaffLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bgUrl, setBgUrl] = useState('');
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

  const onCasdoorLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/auth/staff/casdoor/authorize-url', { timeout: 8000 });
      if (!data?.url) throw new Error('未取得 Casdoor 授权地址');
      // state 同时放入 sessionStorage，回调页做双保险校验
      if (data.state) sessionStorage.setItem('casdoor_state', data.state);
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || t('login.loginFailed'));
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
          <Text type="secondary">{t('login.staffLogin')}</Text>
        </div>
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={onCasdoorLogin}
          >
            {t('login.casdoorLogin')}
          </Button>
          <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
            {t('login.casdoorHint')}
          </Text>
        </Space>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link to="/login">{t('login.customerLoginLink')}</Link>
          <span style={{ margin: '0 8px', color: '#d9d9d9' }}>|</span>
          <Link to="/service-content">{t('login.viewStatusBoard')}</Link>
          <div style={{ marginTop: 8 }}><LanguageSwitcher /></div>
        </div>
      </Card>
    </div>
  );
}
