import type { AppStateSummary } from '../api/types';
import { PlatformStatusRow } from '../components/PlatformStatusRow';

interface ScreenProps {
  appState: AppStateSummary | null;
}

export function ConnectPlatformsScreen({ appState }: ScreenProps) {
  return (
    <section className="surface-band">
      <div className="section-heading">
        <h2>平台连接</h2>
        <p>默认路径应尽量是扫码或浏览器授权；手动凭据只放进高级设置。</p>
      </div>
      <div className="platform-list">
        {(appState?.platforms || []).map((platform) => (
          <PlatformStatusRow key={platform.key} platform={platform} />
        ))}
      </div>
      <div className="action-row">
        <button type="button">导入 Apple 喜欢歌曲</button>
        <button type="button">扫码登录 QQ 音乐</button>
        <button type="button">扫码登录网易云音乐</button>
      </div>
    </section>
  );
}
