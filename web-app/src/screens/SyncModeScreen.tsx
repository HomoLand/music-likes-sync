import type { AppStateSummary, SyncModeId } from '../api/types';
import { SyncModeOption } from '../components/SyncModeOption';

interface ScreenProps {
  appState: AppStateSummary | null;
  selectedMode: SyncModeId;
  onSelectMode: (mode: SyncModeId) => void;
}

export function SyncModeScreen({ appState, selectedMode, onSelectMode }: ScreenProps) {
  const modes = appState?.modes || [];
  return (
    <section className="surface-band">
      <div className="section-heading">
        <h2>选择喜欢歌曲如何流动</h2>
        <p>普通用户只看策略含义和风险，不需要看到 policy id。</p>
      </div>
      <div className="mode-grid">
        {modes.map((mode) => (
          <SyncModeOption
            active={mode.id === selectedMode}
            key={mode.id}
            mode={mode}
            onSelect={onSelectMode}
          />
        ))}
      </div>
    </section>
  );
}
