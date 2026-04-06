import React from 'react';
import { Button } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher({ style }: { style?: React.CSSProperties }) {
  const { i18n, t } = useTranslation();

  const toggle = () => {
    const next = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };

  return (
    <Button
      icon={<GlobalOutlined />}
      onClick={toggle}
      size="small"
      type="text"
      style={style}
    >
      {t('lang.switchTo')}
    </Button>
  );
}
