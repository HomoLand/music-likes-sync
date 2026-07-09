import type { SyncModeId, SyncModeSummary } from '../api/types';

interface SyncModeOptionProps {
  active: boolean;
  mode: SyncModeSummary;
  onSelect: (mode: SyncModeId) => void;
}

const RISK_LABEL: Record<SyncModeSummary['risk'], string> = {
  none: '只读',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export function SyncModeOption({ active, mode, onSelect }: SyncModeOptionProps) {
  return (
    <button
      aria-pressed={active}
      className={active ? 'mode-option active' : 'mode-option'}
      onClick={() => onSelect(mode.id)}
      type="button"
    >
      <div className="mode-head">
        <strong>{mode.label}</strong>
        <span className={`risk-pill ${mode.risk}`}>{RISK_LABEL[mode.risk]}</span>
      </div>
      <p>{mode.description}</p>
      {mode.recommended ? <span className="recommended-pill">推荐</span> : null}
    </button>
  );
}
