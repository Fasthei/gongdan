import React from 'react';
import { Alert, Card, List, Tag, Typography } from 'antd';
import { Citation, UiPayload } from '../../types/kbChat';

const { Text } = Typography;

type Validator = (props: Record<string, any>) => { ok: boolean; error?: string };
type Renderer = (props: Record<string, any>) => React.ReactNode;

interface RegistryEntry {
  validator: Validator;
  render: Renderer;
}

function validateReferenceList(props: Record<string, any>) {
  if (!Array.isArray(props.items)) return { ok: false, error: 'props.items 必须为数组' };
  return { ok: true };
}

function validateStatusPanel(props: Record<string, any>) {
  if (typeof props.status !== 'string') return { ok: false, error: 'props.status 必须为字符串' };
  return { ok: true };
}

const registry: Record<string, RegistryEntry> = {
  'reference_list@1': {
    validator: validateReferenceList,
    render: (props) => {
      const items = (props.items || []) as Citation[];
      return (
        <Card size="small" title="Generative UI · 参考列表">
          <List
            size="small"
            dataSource={items}
            renderItem={(c) => (
              <List.Item>
                <div>
                  <div>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}</div>
                  <Text type="secondary">{c.snippet}</Text>
                </div>
              </List.Item>
            )}
          />
        </Card>
      );
    },
  },
  'status_panel@1': {
    validator: validateStatusPanel,
    render: (props) => (
      <Card size="small" title="Generative UI · 状态面板">
        <Tag color={props.status === 'ok' ? 'success' : 'processing'}>{props.status}</Tag>
        <Text style={{ marginLeft: 8 }}>{props.message || ''}</Text>
      </Card>
    ),
  },
};

export function renderUiPayload(payload: UiPayload, index: number) {
  const key = `${payload.component}@${payload.version}`;
  const entry = registry[key];
  if (!entry) {
    return <Alert key={`ui-${index}`} type="warning" message={`未注册组件: ${key}`} description={payload.fallback_text || '请联系管理员更新前端组件注册表。'} />;
  }
  const result = entry.validator(payload.props || {});
  if (!result.ok) {
    return <Alert key={`ui-${index}`} type="error" message={`组件参数校验失败: ${key}`} description={result.error || payload.fallback_text || '无可用回退内容'} />;
  }
  return <React.Fragment key={`ui-${index}`}>{entry.render(payload.props || {})}</React.Fragment>;
}

