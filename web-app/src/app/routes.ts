export const routes = [
  { id: 'overview', label: '现在同步' },
  { id: 'connect', label: '连接管理' },
  { id: 'mode', label: '同步规则' },
  { id: 'preview', label: '同步预览' },
  { id: 'automation', label: '自动同步' },
  { id: 'ai', label: '音乐库画像' },
  { id: 'advanced', label: '设置' },
] as const;

export type MainRouteId = typeof routes[number]['id'];
export type RouteId = MainRouteId | 'help';
