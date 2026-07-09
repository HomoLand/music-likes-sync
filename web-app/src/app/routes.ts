export const routes = [
  { id: 'overview', label: '概览' },
  { id: 'connect', label: '连接平台' },
  { id: 'mode', label: '同步方式' },
  { id: 'preview', label: '同步预览' },
  { id: 'ai', label: 'AI 助手' },
  { id: 'advanced', label: '高级设置' },
] as const;

export type RouteId = typeof routes[number]['id'];
