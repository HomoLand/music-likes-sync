import type { ReactNode } from 'react';

import type { PlatformSummary } from '../api/types';
import { formatCount, PlatformArtwork, StatusPill } from './MusicVisuals';

interface PlatformStatusRowProps {
  platform: PlatformSummary;
  actions?: ReactNode;
  helper?: string;
  loading?: boolean;
}

const STATUS_LABEL: Record<PlatformSummary['status'], string> = {
  readable: '已读取',
  writable: '可同步',
  needs_attention: '需要处理',
  not_connected: '未连接',
};

export function PlatformStatusRow({ actions, helper, loading = false, platform }: PlatformStatusRowProps) {
  return (
    <article className="platform-row" data-platform={platform.key}>
      <PlatformArtwork platform={platform.key} size="sm" />
      <div>
        <strong>{platform.label}</strong>
        <span>{helper || STATUS_LABEL[platform.status]}</span>
      </div>
      <div className="platform-count">
        <strong>{formatCount(platform.tracks)}</strong>
        <span>首</span>
      </div>
      <div className="platform-row-trailing">
        {loading ? (
          <StatusPill tone="neutral">检查中</StatusPill>
        ) : platform.liveValidation ? (
          <StatusPill tone={platform.liveValidation.ok ? 'success' : 'warning'}>
            {platform.liveValidation.ok ? '真实写入验证已通过' : '需要真实写入验证'}
          </StatusPill>
        ) : (
          <StatusPill tone={platform.status === 'readable' || platform.status === 'writable' ? 'success' : 'warning'}>
            {STATUS_LABEL[platform.status]}
          </StatusPill>
        )}
        {actions ? <div className="platform-row-actions">{actions}</div> : null}
      </div>
    </article>
  );
}
