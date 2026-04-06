import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { AuthProvider } from './contexts/AuthContext';
import { PrivateRoute } from './components/PrivateRoute';
import { useTranslation } from 'react-i18next';
import './i18n';

// 懒加载页面
const CustomerLogin = React.lazy(() => import('./pages/CustomerLogin'));
const StaffLogin = React.lazy(() => import('./pages/StaffLogin'));
const CustomerTicketList = React.lazy(() => import('./pages/customer/TicketList'));
const CustomerTicketDetail = React.lazy(() => import('./pages/customer/TicketDetail'));
const CustomerCreateTicket = React.lazy(() => import('./pages/customer/CreateTicket'));
const OperatorDashboard = React.lazy(() => import('./pages/operator/Dashboard'));
const EngineerDashboard = React.lazy(() => import('./pages/engineer/Dashboard'));
const StatusBoard = React.lazy(() => import('./pages/operator/StatusBoard'));
const ServiceContent = React.lazy(() => import('./pages/ServiceContent'));

function App() {
  const { t, i18n } = useTranslation();
  const antdLocale = i18n.language === 'en-US' ? enUS : zhCN;

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#1a73e8',
          borderRadius: 8,
          fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f8f9fa',
          colorText: '#202124',
          colorTextSecondary: '#5f6368',
        },
        components: {
          Layout: {
            headerBg: '#ffffff',
            headerPadding: '0 24px',
            siderBg: '#ffffff',
          },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: '#e8f0fe',
            itemSelectedColor: '#1a73e8',
            itemHoverBg: '#f1f3f4',
          },
          Card: {
            boxShadowTertiary: '0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)',
          },
          Button: {
            controlHeight: 36,
            paddingInline: 16,
            borderRadius: 18,
          },
          Input: {
            controlHeight: 36,
            borderRadius: 8,
          },
          Table: {
            headerBg: '#f1f3f4',
            headerColor: '#5f6368',
            rowHoverBg: '#f8f9fa',
            borderRadius: 8,
          },
        },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <React.Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>{t('common.loading')}</div>}>
            <Routes>
              {/* 公开路由 */}
              <Route path="/login" element={<CustomerLogin />} />
              <Route path="/staff/login" element={<StaffLogin />} />
              <Route path="/status-board" element={<StatusBoard />} />
              <Route path="/service-content" element={<ServiceContent />} />
              <Route path="/" element={<Navigate to="/login" replace />} />

              {/* 客户路由 */}
              <Route path="/tickets" element={<PrivateRoute roles={['CUSTOMER']}><CustomerTicketList /></PrivateRoute>} />
              <Route path="/tickets/new" element={<PrivateRoute roles={['CUSTOMER']}><CustomerCreateTicket /></PrivateRoute>} />
              <Route path="/tickets/:id" element={<PrivateRoute roles={['CUSTOMER']}><CustomerTicketDetail /></PrivateRoute>} />

              {/* 运营路由 */}
              <Route path="/operator/*" element={<PrivateRoute roles={['OPERATOR']}><OperatorDashboard /></PrivateRoute>} />

              {/* 工程师路由 */}
              <Route path="/engineer/*" element={<PrivateRoute roles={['ENGINEER', 'ADMIN']}><EngineerDashboard /></PrivateRoute>} />

              <Route path="/unauthorized" element={<div style={{ padding: 40 }}>{t('common.unauthorized')}</div>} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}

export default App;
