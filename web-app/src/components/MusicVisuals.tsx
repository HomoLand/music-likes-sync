import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  HelpCircle,
  Home,
  Link2,
  ListChecks,
  Music2,
  Play,
  RefreshCcw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  CalendarClock,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';

import type { PlatformKey } from '../api/types';
import type { RouteId } from '../app/routes';

export const routeIcons: Record<RouteId, typeof Home> = {
  overview: Home,
  connect: Link2,
  mode: SlidersHorizontal,
  preview: ListChecks,
  automation: CalendarClock,
  ai: Sparkles,
  advanced: Settings,
};

export const topStatusIcons = {
  local: CheckCircle2,
  check: TimerReset,
  shield: ShieldCheck,
  refresh: RefreshCcw,
  help: HelpCircle,
};

export const platformMeta: Record<PlatformKey, {
  label: string;
  shortLabel: string;
}> = {
  apple: { label: 'Apple Music', shortLabel: 'Apple' },
  qq: { label: 'QQ 音乐', shortLabel: 'QQ' },
  netease: { label: '网易云音乐', shortLabel: '网易云' },
};

const MUSIC_ASSET_BASE = `${import.meta.env.BASE_URL}assets/music`;
export function PlatformArtwork({
  platform,
  size = 'md',
}: {
  platform: PlatformKey;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`platform-art ${platform} ${size}`} aria-hidden="true">
      <img alt="" src={`${MUSIC_ASSET_BASE}/platform-${platform}.webp`} />
    </span>
  );
}

export function AlbumArtwork({
  title,
  src = '',
  index = 0,
}: {
  title: string;
  src?: string;
  index?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = Boolean(src && !failed);
  return (
    <span className={`album-art tone-${index % 6}`} aria-hidden="true">
      {showImage ? (
        <img alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={src} />
      ) : (
        <Music2 aria-label={`${title || '歌曲'}暂无真实封面`} size={18} />
      )}
    </span>
  );
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function EvidenceChip({
  children,
  tone = 'success',
}: {
  children: React.ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  return <span className={`evidence-chip ${tone}`}>{children}</span>;
}

export function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button aria-label={label} className="icon-button" disabled={disabled} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

export function formatCount(value?: number | null): string {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

export function platformLabel(platform: PlatformKey | string): string {
  return platform === 'apple' || platform === 'qq' || platform === 'netease'
    ? platformMeta[platform].label
    : platform;
}

export function evidenceTone(evidence: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const text = evidence.toLowerCase();
  if (text.includes('未') || text.includes('不同') || text.includes('delete') || text.includes('删除')) return 'warning';
  if (text.includes('低') || text.includes('风险')) return 'danger';
  if (text.includes('isrc') || text.includes('时长') || text.includes('专辑') || text.includes('歌手')) return 'success';
  return 'neutral';
}

export function scoreTone(score?: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (typeof score !== 'number') return 'neutral';
  if (score >= 0.9) return 'success';
  if (score >= 0.72) return 'warning';
  return 'danger';
}

export const PrimaryPlayIcon = Play;
export const BotIcon = Bot;
export const ShieldIcon = BadgeCheck;
