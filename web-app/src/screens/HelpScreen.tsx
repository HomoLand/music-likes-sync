import {
  BookOpen,
  ExternalLink,
  GitBranch,
  Link2,
  RefreshCcw,
  ShieldCheck,
  UserRoundX,
} from 'lucide-react';
import { useState } from 'react';

import type { RouteId } from '../app/routes';

const REPOSITORY_URL = 'https://github.com/HomoLand/music-likes-sync';
const RELEASES_API_URL = 'https://api.github.com/repos/HomoLand/music-likes-sync/releases/latest';

type UpdateState =
  | { status: 'idle' | 'checking' | 'unreleased' | 'error'; message: string }
  | { status: 'latest' | 'available'; message: string; releaseUrl: string };

export function HelpScreen({ onNavigate }: { onNavigate: (route: RouteId) => void }) {
  const [update, setUpdate] = useState<UpdateState>({
    status: 'idle',
    message: '仅在你点击后访问 GitHub Releases，不会自动下载或安装。',
  });

  async function checkForUpdate() {
    setUpdate({ status: 'checking', message: '正在查询 GitHub Releases...' });
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (response.status === 404) {
        setUpdate({ status: 'unreleased', message: `仓库尚未发布正式 Release；当前运行开发版 v${__APP_VERSION__}。` });
        return;
      }
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      const release = await response.json() as { tag_name?: string; html_url?: string };
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const releaseUrl = String(release.html_url || `${REPOSITORY_URL}/releases`);
      if (!latestVersion) throw new Error('发布信息缺少版本号');
      if (compareVersions(latestVersion, __APP_VERSION__) > 0) {
        setUpdate({ status: 'available', message: `发现新版本 v${latestVersion}。`, releaseUrl });
      } else {
        setUpdate({ status: 'latest', message: `当前已是最新发布版本 v${__APP_VERSION__}。`, releaseUrl });
      }
    } catch (error) {
      setUpdate({
        status: 'error',
        message: `暂时无法检查版本：${error instanceof Error ? error.message : '网络不可用'}`,
      });
    }
  }

  return (
    <section className="help-screen" data-testid="react-help-screen">
      <div className="help-intro surface-band">
        <BookOpen size={22} />
        <div>
          <h2>第一次使用，从这里开始</h2>
          <p>Likes Sync 是本机应用，不要求注册产品账号。你只需要连接自己的音乐平台账号。</p>
        </div>
      </div>

      <div className="help-grid">
        <section className="help-section">
          <div className="help-section-head">
            <Link2 size={19} />
            <div>
              <h3>平台账号</h3>
              <p>Apple Music、QQ 音乐和网易云登录都在连接管理中完成。</p>
            </div>
          </div>
          <div className="help-callout">
            <UserRoundX size={18} />
            <span><strong>没有 Likes Sync 云端账号</strong>平台凭据只保存在运行本应用的这台机器上。</span>
          </div>
          <button className="primary-button" onClick={() => onNavigate('connect')} type="button">
            管理平台连接
          </button>
        </section>

        <section className="help-section">
          <div className="help-section-head">
            <ShieldCheck size={19} />
            <div>
              <h3>一次同步怎么完成</h3>
              <p>普通情况下只需要按四步完成。</p>
            </div>
          </div>
          <ol className="help-steps">
            <li><strong>连接平台</strong><span>扫码或完成一次 Apple Music 登录。</span></li>
            <li><strong>选择规则</strong><span>以 Apple Music 喜欢歌曲作为可信源。</span></li>
            <li><strong>复核少量歌曲</strong><span>逐个平台决定保留候选还是换成 Apple 对应版本。</span></li>
            <li><strong>开启自动同步</strong><span>自动新增；删除仍然需要人工确认。</span></li>
          </ol>
          <button className="secondary-button" onClick={() => onNavigate('preview')} type="button">
            回到同步预览
          </button>
        </section>

        <section className="help-section help-version-section">
          <div className="help-section-head">
            <GitBranch size={19} />
            <div>
              <h3>版本与更新</h3>
              <p>当前版本 v{__APP_VERSION__}</p>
            </div>
          </div>
          <p className={`help-update-status ${update.status}`} role="status">{update.message}</p>
          <div className="help-actions">
            <button disabled={update.status === 'checking'} onClick={() => void checkForUpdate()} type="button">
              <RefreshCcw className={update.status === 'checking' ? 'spin' : ''} size={16} />检查新版本
            </button>
            {'releaseUrl' in update ? (
              <a href={update.releaseUrl} rel="noreferrer" target="_blank">
                查看发布说明 <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
          <small>不同安装方式需要不同更新策略，因此目前不会在后台自动更新。</small>
        </section>

        <section className="help-section">
          <div className="help-section-head">
            <BookOpen size={19} />
            <div>
              <h3>完整文档</h3>
              <p>用户指南、平台登录说明和问题反馈。</p>
            </div>
          </div>
          <div className="help-link-list">
            <a href={`${REPOSITORY_URL}/blob/main/docs/USER_GUIDE.zh-CN.md`} rel="noreferrer" target="_blank">
              用户指南 <ExternalLink size={14} />
            </a>
            <a href={`${REPOSITORY_URL}/blob/main/docs/PROVIDERS.md`} rel="noreferrer" target="_blank">
              平台连接与故障排查 <ExternalLink size={14} />
            </a>
            <a href={`${REPOSITORY_URL}/issues`} rel="noreferrer" target="_blank">
              报告问题 <ExternalLink size={14} />
            </a>
          </div>
        </section>
      </div>
    </section>
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map(versionPart);
  const rightParts = right.split(/[.-]/).map(versionPart);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionPart(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
