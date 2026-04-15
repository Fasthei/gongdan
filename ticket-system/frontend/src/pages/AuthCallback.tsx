import React, { useEffect, useRef, useState } from 'react';
import { Card, Spin, Alert, Button, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/**
 * 统一认证中心 (Casdoor) 登录回调页：
 *   /staff/auth/callback?code=xxx&state=yyy
 * 交换 code → 本系统 JWT，成功后根据角色跳转。
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const oauthErr = params.get('error');

    if (oauthErr) {
      setError(params.get('error_description') || oauthErr);
      return;
    }
    if (!code || !state) {
      setError(t('login.callbackMissingParams'));
      return;
    }

    const savedState = sessionStorage.getItem('casdoor_state');
    if (savedState && savedState !== state) {
      setError(t('login.callbackStateMismatch'));
      return;
    }

    (async () => {
      try {
        const { data } = await api.post(
          '/auth/staff/casdoor/callback',
          { code, state },
          { timeout: 15000 },
        );
        sessionStorage.removeItem('casdoor_state');
        login(data.accessToken, data.refreshToken, data.user);
        const role = data.user?.role;
        if (role === 'OPERATOR') navigate('/operator', { replace: true });
        else navigate('/engineer', { replace: true });
      } catch (err: any) {
        setError(err.response?.data?.message || err.message || t('login.loginFailed'));
      }
    })();
  }, [params, login, navigate, t]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 420, textAlign: 'center' }}>
        <Title level={4}>{t('login.casdoorLogin')}</Title>
        {!error ? (
          <>
            <Spin size="large" style={{ margin: '24px 0' }} />
            <Text type="secondary" style={{ display: 'block' }}>
              {t('login.callbackProcessing')}
            </Text>
          </>
        ) : (
          <>
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ textAlign: 'left', margin: '16px 0' }}
            />
            <Button type="primary" onClick={() => navigate('/staff/login', { replace: true })}>
              {t('login.backToLogin')}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
