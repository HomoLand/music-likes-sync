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
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <h2>喜欢歌曲如何流动</h2>
          <p>普通用户只看策略含义和风险，不需要理解 policy id。</p>
        </div>
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
