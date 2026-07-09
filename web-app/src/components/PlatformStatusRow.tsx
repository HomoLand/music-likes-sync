import type { PlatformSummary } from '../api/types';

interface PlatformStatusRowProps {
  platform: PlatformSummary;
}

const STATUS_LABEL: Record<PlatformSummary['status'], string> = {
  readable: '已读取',
  writable: '可同步',
  needs_attention: '需要处理',
  not_connected: '未连接',
};

export function PlatformStatusRow({ platform }: PlatformStatusRowProps) {
  return (
    <article className="platform-row">
      <div>
        <strong>{platform.label}</strong>
        <span>{STATUS_LABEL[platform.status]}</span>
      </div>
      <div className="platform-count">
        <strong>{platform.tracks}</strong>
        <span>首</span>
      </div>
      {platform.liveValidation ? (
        <div className={platform.liveValidation.ok ? 'validation-pill ready' : 'validation-pill'}>
          {platform.liveValidation.ok ? '真实写入验证已通过' : '需要真实写入验证'}
        </div>
      ) : null}
    </article>
  );
}
