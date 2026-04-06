import React from 'react';
import { Card, Table, Typography, Tag, Steps, Divider, Alert, Space, Tabs } from 'antd';
import {
  BookOutlined, TeamOutlined, ThunderboltOutlined, OrderedListOutlined,
  SafetyCertificateOutlined, ApartmentOutlined, FileTextOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import StatusBoard from './operator/StatusBoard';

const { Title, Text, Paragraph } = Typography;

export default function ServiceContentPage() {
  const { t } = useTranslation();

  const sc = (key: string) => t(`serviceContent.${key}`);
  const scArr = (key: string): string[] => t(`serviceContent.${key}`, { returnObjects: true }) as unknown as string[];

  const sectionCard = (icon: React.ReactNode, titleKey: string, children: React.ReactNode) => (
    <Card
      bordered={false}
      style={{ marginBottom: 16 }}
      title={<Space>{icon}<span>{sc(titleKey)}</span></Space>}
    >
      {children}
    </Card>
  );

  const renderTable = (headerKey: string, rows: string[][], rowKeys: string[]) => {
    const headers: string[] = scArr(headerKey);
    const columns = headers.map((h, i) => ({ title: h, dataIndex: `col${i}`, key: `col${i}` }));
    const dataSource = rowKeys.map((rk, idx) => {
      const row: string[] = scArr(rk);
      const obj: any = { key: idx };
      row.forEach((v, i) => { obj[`col${i}`] = v; });
      return obj;
    });
    return <Table columns={columns} dataSource={dataSource} pagination={false} size="small" bordered />;
  };

  const policyContent = (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <Card bordered={false} style={{ marginBottom: 24, textAlign: 'center' }}>
        <Title level={2} style={{ marginBottom: 16 }}>{sc('mainTitle')}</Title>
        <Space split={<Divider type="vertical" />}>
          <Text type="secondary">{sc('docNumber')}: {sc('docNumberValue')}</Text>
          <Text type="secondary">{sc('version')}: {sc('versionValue')}</Text>
          <Text type="secondary">{sc('scope')}: {sc('scopeValue')}</Text>
          <Text type="secondary">{sc('effectiveDate')}: {sc('effectiveDateValue')}</Text>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Text>{sc('department')}</Text>
        </div>
        <Alert message={sc('intro')} type="info" showIcon style={{ marginTop: 16, textAlign: 'left' }} />
      </Card>

      {/* Section 1: Purpose */}
      {sectionCard(<BookOutlined />, 'section1Title',
        <Paragraph>{sc('section1Content')}</Paragraph>
      )}

      {/* Section 2: Scope */}
      {sectionCard(<TeamOutlined />, 'section2Title',
        <Paragraph>{sc('section2Content')}</Paragraph>
      )}

      {/* Section 3: Principles */}
      {sectionCard(<SafetyCertificateOutlined />, 'section3Title',
        <Paragraph>{sc('section3Content')}</Paragraph>
      )}

      {/* Section 5: Customer Tiers */}
      {sectionCard(<TeamOutlined style={{ color: '#1a73e8' }} />, 'section5Title',
        <>
          <Paragraph>{sc('section5Intro')}</Paragraph>
          {renderTable('tierHeader', [], ['tierNormal', 'tierKey', 'tierExclusive'])}
          <Alert message={sc('section5Note')} type="warning" showIcon style={{ marginTop: 12 }} />
        </>
      )}

      {/* Section 6: Engineer Levels */}
      {sectionCard(<ApartmentOutlined style={{ color: '#52c41a' }} />, 'section6Title',
        <>
          <Paragraph>{sc('section6Intro')}</Paragraph>
          {renderTable('engHeader', [], ['engL1', 'engL2', 'engL3'])}
        </>
      )}

      {/* Section 7: Priority Rules */}
      {sectionCard(<ThunderboltOutlined style={{ color: '#faad14' }} />, 'section7Title',
        <>
          <Paragraph>{sc('section7Intro')}</Paragraph>
          {renderTable('prioHeader', [], ['prioNormal', 'prioKey', 'prioExclusive'])}
        </>
      )}

      {/* Section 8: Processing Flow */}
      {sectionCard(<OrderedListOutlined style={{ color: '#1a73e8' }} />, 'section8Title',
        <>
          <Steps
            direction="vertical"
            current={-1}
            items={(scArr('flow') as string[]).map((text, i) => ({
              title: text,
              status: 'process' as const,
            }))}
            style={{ marginBottom: 16 }}
          />
          <Alert message={sc('flowNote')} type="info" showIcon />
        </>
      )}

      {/* Section 9: Submission Requirements */}
      {sectionCard(<FileTextOutlined />, 'section9Title',
        <>
          <Paragraph>{sc('section9Intro')}</Paragraph>
          <ul>
            {(scArr('section9Items') as string[]).map((item, i) => (
              <li key={i}><Text>{item}</Text></li>
            ))}
          </ul>
          <Paragraph type="secondary">{sc('section9Note1')}</Paragraph>
          <Paragraph type="secondary">{sc('section9Note2')}</Paragraph>
        </>
      )}

      {/* Section 13: Communication & Discipline */}
      {sectionCard(<SafetyCertificateOutlined style={{ color: '#ff4d4f' }} />, 'section13Title',
        renderTable('commHeader', [], ['commRows'])
      )}

      {/* Section 14: SLO Standards */}
      {sectionCard(<ThunderboltOutlined style={{ color: '#52c41a' }} />, 'section14Title',
        renderTable('sloHeader', [], ['sloNormal', 'sloKey', 'sloExclusive'])
      )}

      {/* Section 15: Organization */}
      {sectionCard(<TeamOutlined style={{ color: '#722ed1' }} />, 'section15Title',
        <>
          <Paragraph>{sc('section15Intro')}</Paragraph>
          {renderTable('orgHeader', [], ['orgL3', 'orgL2', 'orgL1'])}
        </>
      )}

      {/* Section 16: Execution */}
      {sectionCard(<FileTextOutlined />, 'section16Title',
        <>
          <Paragraph>{sc('section16Content1')}</Paragraph>
          <Paragraph>{sc('section16Content2')}</Paragraph>
        </>
      )}
    </div>
  );

  return (
    <div style={{ padding: '24px 16px' }}>
      <Tabs
        defaultActiveKey="status"
        size="large"
        items={[
          {
            key: 'status',
            label: <span><DashboardOutlined style={{ marginRight: 6 }} />{t('statusBoard.title')}</span>,
            children: <StatusBoard />,
          },
          {
            key: 'policy',
            label: <span><BookOutlined style={{ marginRight: 6 }} />{sc('mainTitle')}</span>,
            children: policyContent,
          },
        ]}
      />
    </div>
  );
}
