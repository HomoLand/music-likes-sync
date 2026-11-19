import {
  CheckCircle2,
  FileUp,
  ListMusic,
  LogIn,
  MonitorUp,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  checkAppleConnection,
  checkNeteaseQrLogin,
  checkQQBrowserLogin,
  checkQQQrLogin,
  fetchQQPlaylists,
  importAppleLibrary,
  openQQBrowserLogin,
  refreshPlatformSnapshot,
  startAppleConnection,
  startNeteaseQrLogin,
  startQQQrLogin,
} from '../api/client';
import type {
  AppStateSummary,
  NeteaseQrSession,
  PlatformKey,
  PlatformSummary,
  QQPlaylistSummary,
  QQQrSession,
} from '../api/types';
import { PlatformStatusRow } from '../components/PlatformStatusRow';
import { PlatformArtwork, StatusPill } from '../components/MusicVisuals';

interface ScreenProps {
  appState: AppStateSummary | null;
  onRefresh: () => Promise<void>;
}

type ConnectionDialog = 'apple' | 'qq' | 'netease' | null;

export function ConnectPlatformsScreen({ appState, onRefresh }: ScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<ConnectionDialog>(null);
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [applePolling, setApplePolling] = useState(false);
  const [appleStatus, setAppleStatus] = useState('等待连接 Apple Music');
  const [qqPolling, setQqPolling] = useState(false);
  const [qqStatus, setQqStatus] = useState('等待生成二维码');
  const [qqQrSession, setQqQrSession] = useState<QQQrSession | null>(null);
  const [qqQrMethod, setQqQrMethod] = useState<'qq' | 'wechat'>('qq');
  const [qqPlaylists, setQqPlaylists] = useState<QQPlaylistSummary[]>([]);
  const [qqCredentialRejected, setQqCredentialRejected] = useState(false);
  const [neteaseSession, setNeteaseSession] = useState<NeteaseQrSession | null>(null);
  const [neteaseStatus, setNeteaseStatus] = useState('等待生成二维码');

  const busy = Boolean(busyAction);
  const stateReady = appState !== null;
  const applePlatform = platformByKey(appState, 'apple');
  const qqPlatform = platformByKey(appState, 'qq');
  const neteasePlatform = platformByKey(appState, 'netease');
  const appleConnected = stateReady && applePlatform.credentialPresent;
  const qqCredentialPresent = stateReady && qqPlatform.credentialPresent && !qqCredentialRejected;
  const qqNeedsCredentials = stateReady && !qqCredentialPresent;

  useEffect(() => {
    if (!applePolling) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await checkAppleConnection();
        if (cancelled) return;
        setAppleStatus(result.status.message || result.message);
        if (result.status.done) {
          setApplePolling(false);
          setMessage(result.message);
          await onRefresh();
          return;
        }
        if (!result.status.waiting) {
          setApplePolling(false);
          setError(result.message);
          return;
        }
        timer = window.setTimeout(poll, 1800);
      } catch (pollError) {
        if (!cancelled) {
          setApplePolling(false);
          setError(errorMessage(pollError));
        }
      }
    };

    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applePolling]);

  useEffect(() => {
    if (!qqPolling) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await checkQQBrowserLogin();
        if (cancelled) return;
        setQqStatus(result.status?.message || result.message);
        if (result.status?.done) {
          setQqPolling(false);
          await finishProviderConnection('qq');
          return;
        }
        if (!result.status?.waiting) {
          setQqPolling(false);
          setError(result.message);
          return;
        }
        timer = window.setTimeout(poll, 1800);
      } catch (pollError) {
        if (!cancelled) {
          setQqPolling(false);
          setError(errorMessage(pollError));
        }
      }
    };

    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [qqPolling]);

  useEffect(() => {
    if (!qqQrSession?.key) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await checkQQQrLogin(qqQrSession.key);
        if (cancelled) return;
        setQqStatus(result.status?.message || result.message);
        if (result.status?.done) {
          setQqQrSession(null);
          await finishProviderConnection('qq');
          return;
        }
        if (!result.status?.waiting) {
          setQqQrSession(null);
          setError(result.message);
          return;
        }
        timer = window.setTimeout(poll, 1600);
      } catch (pollError) {
        if (!cancelled) {
          setQqQrSession(null);
          setError(errorMessage(pollError));
        }
      }
    };

    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [qqQrSession?.key]);

  useEffect(() => {
    if (!neteaseSession?.key) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await checkNeteaseQrLogin(neteaseSession.key);
        if (cancelled) return;
        setNeteaseStatus(result.message);
        if (result.done) {
          await finishProviderConnection('netease');
          return;
        }
        if (result.code === 800 || !result.waiting) {
          setError(result.code === 800 ? '二维码已过期，请重新生成。' : result.message);
          return;
        }
        timer = window.setTimeout(poll, 1800);
      } catch (pollError) {
        if (!cancelled) setError(errorMessage(pollError));
      }
    };

    timer = window.setTimeout(poll, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [neteaseSession?.key]);

  async function runAction<T extends { message: string }>(label: string, action: () => Promise<T>): Promise<T | null> {
    setBusyAction(label);
    setMessage('');
    setError('');
    try {
      const result = await action();
      setMessage(result.message);
      return result;
    } catch (actionError) {
      setError(errorMessage(actionError));
      return null;
    } finally {
      setBusyAction('');
    }
  }

  async function finishProviderConnection(platform: 'qq' | 'netease') {
    setBusyAction(`${platform}-snapshot`);
    setError('');
    setMessage(`${platformLabel(platform)} 登录成功，正在读取喜欢歌曲...`);
    try {
      await refreshPlatformSnapshot(platform);
      await onRefresh();
      if (platform === 'qq') {
        setQqCredentialRejected(false);
        setQqQrSession(null);
        const playlists = await fetchQQPlaylists().catch(() => null);
        if (playlists) setQqPlaylists(playlists.playlists);
      }
      setMessage(`${platformLabel(platform)} 已连接，喜欢歌曲已更新。`);
      if (platform === 'netease') setNeteaseStatus('登录成功，喜欢歌曲已更新');
      if (platform === 'qq') setQqStatus('登录成功，喜欢歌曲已更新');
    } catch (snapshotError) {
      setError(`登录凭据已保存，但读取喜欢歌曲失败：${errorMessage(snapshotError)}`);
    } finally {
      setBusyAction('');
    }
  }

  async function handleAppleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setDialog('apple');
    const content = await file.text();
    const result = await runAction('apple-import', () => importAppleLibrary({ content, filename: file.name }));
    if (result) await onRefresh();
  }

  async function handleAppleConnect() {
    setDialog('apple');
    setApplePolling(false);
    setAppleStatus('正在打开 Apple 官方登录页...');
    const result = await runAction('apple-connect', startAppleConnection);
    if (!result) return;
    setAppleStatus(result.status.message || result.message);
    if (result.status.done) {
      await onRefresh();
      return;
    }
    if (result.status.waiting) {
      setApplePolling(true);
    } else {
      setError(result.message);
    }
  }

  async function handleQQQrLogin(force = false) {
    setDialog('qq');
    setQqPolling(false);
    setQqQrSession(null);
    setQqStatus('正在从腾讯官方登录页生成二维码...');
    const result = await runAction('qq-qr-start', () => startQQQrLogin({ force }));
    if (!result) return;
    setQqStatus(result.status.message || result.message);
    if (result.status.done) {
      setQqCredentialRejected(false);
      await finishProviderConnection('qq');
      return;
    }
    setQqCredentialRejected(true);
    if (!result.key || (!result.images.qq && !result.images.wechat)) {
      setError('腾讯登录页没有返回可用二维码，请重新生成或使用本机快捷登录。');
      return;
    }
    setQqQrMethod(result.images.qq ? 'qq' : 'wechat');
    setQqQrSession(result);
  }

  async function handleQQQuickLogin() {
    setDialog('qq');
    setQqCredentialRejected(true);
    setQqQrSession(null);
    setQqPlaylists([]);
    setQqStatus('正在打开腾讯官方登录页...');
    const result = await runAction('qq-browser-open', openQQBrowserLogin);
    if (!result) return;
    setQqStatus('可使用页面里的本机 QQ 或微信快捷登录；完成后会自动继续。');
    setQqPolling(true);
  }

  async function handleLoadQQPlaylists() {
    setDialog('qq');
    const result = await runAction('qq-playlists', fetchQQPlaylists);
    if (result) setQqPlaylists(result.playlists);
  }

  async function handleNeteaseLogin() {
    setDialog('netease');
    setNeteaseSession(null);
    setNeteaseStatus('正在生成二维码...');
    const result = await runAction('netease-qr-start', startNeteaseQrLogin);
    if (!result) return;
    setNeteaseSession(result);
    setNeteaseStatus('请用网易云音乐 App 扫码并在手机上确认');
  }

  function closeDialog() {
    setDialog(null);
    setApplePolling(false);
    setQqPolling(false);
    setQqQrSession(null);
    setNeteaseSession(null);
    setError('');
  }

  return (
    <section className="surface-panel connect-screen" data-testid="react-connect-screen">
      <div className="section-heading connection-heading">
        <div>
          <h2>平台连接</h2>
          <p>首次完成官方登录即可；之后应用会在后台续用会话，登录凭据只保存在这台电脑。</p>
        </div>
        <StatusPill tone="success"><ShieldCheck size={13} />本地凭据保护</StatusPill>
      </div>

      <input
        accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
        className="visually-hidden"
        data-testid="react-apple-file-input"
        onChange={handleAppleFile}
        ref={fileInputRef}
        type="file"
      />

      <div className="platform-list connection-platform-list">
        <PlatformStatusRow
          actions={!stateReady ? undefined : (
            <>
              <button data-testid="react-apple-connect" onClick={handleAppleConnect} type="button">
                {appleConnected ? <RefreshCcw size={15} /> : <LogIn size={15} />}
                {appleConnected ? '刷新喜爱歌曲' : '连接 Apple Music'}
              </button>
              <button data-testid="react-apple-import-trigger" onClick={() => fileInputRef.current?.click()} type="button"><FileUp size={15} />导入文件</button>
            </>
          )}
          helper={!stateReady ? '正在检查本机登录状态' : appleConnected ? '登录状态已保存在本机，刷新时自动续用' : '首次完成 Apple 官方登录，之后静默刷新'}
          loading={!stateReady}
          platform={applePlatform}
        />
        <PlatformStatusRow
          actions={!stateReady ? undefined : qqNeedsCredentials ? (
            <button data-testid="react-qq-login" onClick={() => handleQQQrLogin()} type="button"><QrCode size={15} />扫码连接</button>
          ) : (
            <>
              <button data-testid="react-qq-playlists" onClick={handleLoadQQPlaylists} type="button"><ListMusic size={15} />查看歌单</button>
            </>
          )}
          helper={!stateReady ? '正在检查本机登录状态' : qqNeedsCredentials ? 'QQ 或微信扫码，也可使用本机快捷登录' : '已自动续用这台电脑上的登录状态'}
          loading={!stateReady}
          platform={qqPlatform}
        />
        <PlatformStatusRow
          actions={!stateReady ? undefined : (
            <button data-testid="react-netease-login" onClick={handleNeteaseLogin} type="button"><QrCode size={15} />扫码登录</button>
          )}
          helper="用网易云音乐 App 扫码确认"
          loading={!stateReady}
          platform={neteasePlatform}
        />
      </div>

      <div className="connection-legend">
        <div><CheckCircle2 size={16} /><span><strong>已连接</strong>可以读取并同步变更</span></div>
        <div><RefreshCcw size={16} /><span><strong>需要更新</strong>重新登录后自动刷新曲库</span></div>
        <div><ShieldCheck size={16} /><span><strong>写入验证</strong>真实新增与删除验证仍独立保护</span></div>
      </div>

      {message ? <p className="sync-status" role="status">{message}</p> : null}
      {error ? <p className="sync-status error" role="alert">{error}</p> : null}

      {dialog ? (
        <div className="connection-dialog-backdrop">
          <section aria-modal="true" className="connection-dialog" data-testid="react-connection-dialog" role="dialog">
            <header>
              <div>
                <PlatformArtwork platform={dialog} size="md" />
                <span>
                  <strong>{platformLabel(dialog)}</strong>
                  <small>{dialog === 'qq' && !qqNeedsCredentials ? '已使用本机登录状态' : dialogSubtitle(dialog)}</small>
                </span>
              </div>
              <button aria-label="关闭" className="icon-button" data-testid="react-connection-close" onClick={closeDialog} type="button"><X size={17} /></button>
            </header>

            {dialog === 'apple' ? (
              <div className="connection-dialog-body">
                <div className={`connection-stage ${applePolling ? 'active' : ''}`} data-testid="react-apple-login-status">
                  {applePolling ? <RefreshCcw className="status-spinner" size={20} /> : <CheckCircle2 size={20} />}
                  <span>
                    <strong>{applePolling ? '等待 Apple 登录' : appleConnected ? 'Apple Music 已连接' : '一次登录，之后自动刷新'}</strong>
                    <small>{appleStatus}</small>
                  </span>
                </div>
                <div className="connection-dialog-actions">
                  <button className="primary-button" disabled={busy || applePolling} onClick={handleAppleConnect} type="button">
                    {appleConnected ? <RefreshCcw size={16} /> : <LogIn size={16} />}
                    {applePolling ? '等待登录完成' : appleConnected ? '刷新喜爱歌曲' : '使用 Apple Music 登录'}
                  </button>
                  <button className="secondary-button" disabled={busy} onClick={() => fileInputRef.current?.click()} type="button">
                    <FileUp size={16} />改用文件导入
                  </button>
                </div>
                <p className="connection-privacy-note"><ShieldCheck size={14} />登录保存在这台电脑的专用浏览器档案中，应用不会显示 Apple 凭据。</p>
              </div>
            ) : null}

            {dialog === 'qq' ? (
              qqNeedsCredentials ? (
                <div className="connection-dialog-body qq-qr-flow">
                  <div className="qr-image-frame">
                    {qqQrSession?.images[qqQrMethod] ? (
                      <img
                        alt={`${qqQrMethod === 'qq' ? 'QQ' : '微信'}登录二维码`}
                        data-testid="react-qq-qr-image"
                        src={qqQrSession.images[qqQrMethod]}
                      />
                    ) : (
                      <QrCode size={62} />
                    )}
                  </div>
                  {qqQrSession?.images.qq && qqQrSession.images.wechat ? (
                    <div aria-label="扫码方式" className="qr-method-switch">
                      <button aria-pressed={qqQrMethod === 'qq'} onClick={() => setQqQrMethod('qq')} type="button">QQ 扫码</button>
                      <button aria-pressed={qqQrMethod === 'wechat'} onClick={() => setQqQrMethod('wechat')} type="button">微信扫码</button>
                    </div>
                  ) : null}
                  <div className={`connection-stage ${qqQrSession || qqPolling ? 'active' : ''}`} data-testid="react-qq-login-status">
                    {qqQrSession || qqPolling ? <RefreshCcw className="status-spinner" size={20} /> : <CheckCircle2 size={20} />}
                    <span><strong>{qqQrSession ? '等待手机确认' : qqPolling ? '等待快捷登录' : 'QQ 音乐连接'}</strong><small>{qqStatus}</small></span>
                  </div>
                  <div className="connection-dialog-actions">
                    <button className="primary-button" disabled={busy} onClick={() => handleQQQrLogin(Boolean(qqQrSession))} type="button"><QrCode size={16} />{qqQrSession ? '重新生成二维码' : '生成登录二维码'}</button>
                    <button className="secondary-button" disabled={busy} onClick={handleQQQuickLogin} type="button"><MonitorUp size={16} />使用本机快捷登录</button>
                  </div>
                  <p className="connection-privacy-note"><ShieldCheck size={14} />二维码来自腾讯官方页面，登录信息只写入本机专用会话。</p>
                </div>
              ) : (
                <div className="connection-dialog-body" data-testid="react-qq-connected">
                  <div className={`connection-stage ${busyAction === 'qq-qr-start' ? 'active' : ''}`}>
                    {busyAction === 'qq-qr-start' ? <RefreshCcw className="status-spinner" size={20} /> : <CheckCircle2 size={20} />}
                    <span>
                      <strong>{busyAction === 'qq-qr-start' ? '正在检查连接' : 'QQ 音乐已连接'}</strong>
                      <small>{busyAction === 'qq-qr-start' ? qqStatus : '已在本机找到登录状态，不需要再次扫码。'}</small>
                    </span>
                  </div>
                  <div className="connection-dialog-actions">
                    <button className="primary-button" disabled={busy} onClick={handleLoadQQPlaylists} type="button"><ListMusic size={16} />{qqPlaylists.length ? '刷新我的歌单' : '读取我的歌单'}</button>
                    <button className="secondary-button" data-testid="react-qq-connection-check" disabled={busy} onClick={() => handleQQQrLogin()} type="button"><RefreshCcw size={16} />检查连接</button>
                  </div>
                  <p className="connection-privacy-note"><ShieldCheck size={14} />只有当前登录状态不可用时，才会显示二维码和本机快捷登录。</p>
                  <QQPlaylistList playlists={qqPlaylists} />
                </div>
              )
            ) : null}

            {dialog === 'netease' ? (
              <div className="connection-dialog-body netease-qr-flow">
                <div className="qr-image-frame">
                  {neteaseSession?.image ? (
                    <img alt="网易云音乐登录二维码" data-testid="react-netease-qr-image" src={neteaseSession.image} />
                  ) : (
                    <QrCode size={62} />
                  )}
                </div>
                <div className="connection-stage active">
                  <RefreshCcw className={neteaseSession ? 'status-spinner' : ''} size={20} />
                  <span><strong>{neteaseStatus}</strong><small>二维码过期后可直接重新生成</small></span>
                </div>
                <button className="secondary-button" disabled={busy} onClick={handleNeteaseLogin} type="button"><RefreshCcw size={16} />重新生成二维码</button>
              </div>
            ) : null}

            {busyAction ? <p className="connection-progress">正在处理，请稍候...</p> : null}
            {message ? <p className="sync-status" role="status">{message}</p> : null}
            {error ? <p className="sync-status error" role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function QQPlaylistList({ playlists }: { playlists: QQPlaylistSummary[] }) {
  if (!playlists.length) return null;
  return (
    <div className="connection-playlist-list" data-testid="react-qq-playlist-list">
      <div className="connection-playlist-head">
        <strong>我的歌单</strong>
        <span>{playlists.length} 个</span>
      </div>
      {playlists.map((playlist) => (
        <div className="connection-playlist-row" key={`${playlist.dirid}:${playlist.tid}:${playlist.id}`}>
          <ListMusic size={17} />
          <span>
            <strong>{playlist.name}{playlist.isLiked ? ' · 我喜欢' : ''}</strong>
            <small>{playlist.songCount} 首 · {playlist.dirid ? `dirid ${playlist.dirid}` : playlist.tid ? `tid ${playlist.tid}` : '只读歌单'}</small>
          </span>
          {playlist.isLiked ? <StatusPill tone="accent">同步目标</StatusPill> : null}
        </div>
      ))}
    </div>
  );
}

function platformByKey(appState: AppStateSummary | null, key: PlatformKey): PlatformSummary {
  return appState?.platforms.find((platform) => platform.key === key) || {
    key,
    label: platformLabel(key),
    status: 'not_connected',
    credentialPresent: false,
    tracks: 0,
  };
}

function platformLabel(platform: PlatformKey): string {
  if (platform === 'apple') return 'Apple Music';
  if (platform === 'qq') return 'QQ 音乐';
  return '网易云音乐';
}

function dialogSubtitle(dialog: Exclude<ConnectionDialog, null>): string {
  if (dialog === 'apple') return '登录一次，自动定位喜爱歌曲';
  if (dialog === 'qq') return 'QQ 或微信扫码连接';
  return '用网易云音乐 App 扫码';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '连接操作失败');
}
