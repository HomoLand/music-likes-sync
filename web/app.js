const $ = (selector) => document.querySelector(selector);

const PLATFORM_LABELS = {
  apple: 'Apple',
  qq: 'QQ',
  netease: '网易云',
};

const FILTER_LABELS = {
  'sync-queue': '待同步',
  'review-queue': '待判断',
  resolved: '已判断',
  all: '全部曲库',
};

const AUTH_QUOTES = [
  '把歌单先放在同一张桌上，剩下的交给匹配。',
  '收藏夹不需要忠诚，只需要完整。',
  '先抓快照，再谈版本；先有证据，再做同步。',
  '同一首歌可以有很多名字，目标曲库只认清单。',
  '今天少漏一首歌，明天少一次手工补。',
];
const HITOKOTO_URL = 'https://v1.hitokoto.cn/?c=d&c=i&c=j&encode=json&charset=utf-8&max_length=48';

const elements = {
  appleForm: $('#appleForm'),
  appleFile: $('#appleFile'),
  appleText: $('#appleText'),
  appleUrl: $('#appleUrl'),
  appleUrlButton: $('#appleUrlButton'),
  appleBrowserOpenButton: $('#appleBrowserOpenButton'),
  appleBrowserCaptureButton: $('#appleBrowserCaptureButton'),
  dropzone: $('#dropzone'),
  fileLabel: $('#fileLabel'),
  cookieForm: $('#cookieForm'),
  qqCookie: $('#qqCookie'),
  neteaseCookie: $('#neteaseCookie'),
  manualCookieDetails: $('#manualCookieDetails'),
  authStage: $('#authStage'),
  qqBrowserOpenButton: $('#qqBrowserOpenButton'),
  qqBrowserCaptureButton: $('#qqBrowserCaptureButton'),
  neteaseQrButton: $('#neteaseQrButton'),
  neteaseQrBox: $('#neteaseQrBox'),
  neteaseQrImage: $('#neteaseQrImage'),
  neteaseQrPlaceholder: $('#neteaseQrPlaceholder'),
  neteaseQrTitle: $('#neteaseQrTitle'),
  neteaseQrHint: $('#neteaseQrHint'),
  qqSnapshotButton: $('#qqSnapshotButton'),
  neteaseSnapshotButton: $('#neteaseSnapshotButton'),
  snapshotButton: $('#snapshotButton'),
  metadataButton: $('#metadataButton'),
  matchButton: $('#matchButton'),
  unifiedButton: $('#unifiedButton'),
  refreshButton: $('#refreshButton'),
  qqPlaylistId: $('#qqPlaylistId'),
  neteasePlaylistId: $('#neteasePlaylistId'),
  threshold: $('#threshold'),
  reviewThreshold: $('#reviewThreshold'),
  appleCount: $('#appleCount'),
  qqCount: $('#qqCount'),
  neteaseCount: $('#neteaseCount'),
  cookieState: $('#cookieState'),
  qqCookieStatus: $('#qqCookieStatus'),
  neteaseCookieStatus: $('#neteaseCookieStatus'),
  authQuoteText: $('#authQuoteText'),
  authQuoteFrom: $('#authQuoteFrom'),
  authQuoteRefresh: $('#authQuoteRefresh'),
  statusStack: $('#statusStack'),
  reportTime: $('#reportTime'),
  summaryGrid: $('#summaryGrid'),
  librarySearch: $('#librarySearch'),
  deepseekApiKey: $('#deepseekApiKey'),
  deepseekModel: $('#deepseekModel'),
  aiBatchSize: $('#aiBatchSize'),
  aiConsent: $('#aiConsent'),
  aiThinking: $('#aiThinking'),
  aiReviewButton: $('#aiReviewButton'),
  aiApplyThreshold: $('#aiApplyThreshold'),
  aiApplyOverwrite: $('#aiApplyOverwrite'),
  aiApplyButton: $('#aiApplyButton'),
  aiApplySummary: $('#aiApplySummary'),
  libraryResultCount: $('#libraryResultCount'),
  decisionSummary: $('#decisionSummary'),
  aiSummary: $('#aiSummary'),
  libraryList: $('#libraryList'),
  loadMoreButton: $('#loadMoreButton'),
  toast: $('#toast'),
};

let selectedFileName = '';
let busy = false;
let neteaseQrKey = '';
let neteaseQrTimer = 0;
let currentState = null;
let activeFilter = 'sync-queue';
let libraryOffset = 0;
let libraryLimit = 40;
let searchTimer = 0;
let manualCloseTarget = '';

init();

function init() {
  bindEvents();
  resetAuthStage();
  fetchAuthQuote();
  refreshState();
}

function resetAuthStage() {
  if (elements.manualCookieDetails) elements.manualCookieDetails.open = false;
  hideNeteaseQr({ stopPolling: true });
  setAuthStage('quote');
}

function renderLocalAuthQuote() {
  if (!elements.authQuoteText) return;
  const index = new Date().getDate() % AUTH_QUOTES.length;
  elements.authQuoteText.textContent = AUTH_QUOTES[index];
  if (elements.authQuoteFrom) {
    elements.authQuoteFrom.textContent = '本地 fallback / hitokoto.cn 暂不可用';
  }
}

async function fetchAuthQuote() {
  if (!elements.authQuoteText) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4200);
  if (elements.authQuoteRefresh) elements.authQuoteRefresh.disabled = true;
  if (elements.authQuoteFrom) elements.authQuoteFrom.textContent = '正在从 hitokoto.cn 取一句';

  try {
    const response = await fetch(HITOKOTO_URL, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`hitokoto ${response.status}`);
    const data = await response.json();
    const text = String(data.hitokoto || '').trim();
    if (!text) throw new Error('hitokoto empty');

    elements.authQuoteText.textContent = text;
    if (elements.authQuoteFrom) {
      const source = [data.from_who, data.from].filter(Boolean).join(' / ');
      elements.authQuoteFrom.textContent = source ? `来自 ${source}` : '来自 hitokoto.cn';
    }
  } catch {
    renderLocalAuthQuote();
  } finally {
    clearTimeout(timer);
    if (elements.authQuoteRefresh) elements.authQuoteRefresh.disabled = false;
  }
}

function bindEvents() {
  elements.authQuoteRefresh?.addEventListener('click', fetchAuthQuote);
  elements.manualCookieDetails?.addEventListener('toggle', () => {
    if (manualCloseTarget) {
      const target = manualCloseTarget;
      manualCloseTarget = '';
      setAuthStage(target);
      return;
    }
    if (elements.manualCookieDetails.open) {
      hideNeteaseQr({ stopPolling: true });
      setAuthStage('manual');
      return;
    }
    if (!elements.neteaseQrBox.hidden) {
      setAuthStage('qr');
      return;
    }
    setAuthStage('quote');
  });

  elements.appleFile.addEventListener('change', async () => {
    const file = elements.appleFile.files?.[0];
    if (!file) return;
    selectedFileName = file.name;
    elements.fileLabel.textContent = file.name;
    elements.appleText.value = await file.text();
  });

  for (const eventName of ['dragenter', 'dragover']) {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add('dragging');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    elements.dropzone.addEventListener(eventName, () => {
      elements.dropzone.classList.remove('dragging');
    });
  }

  elements.dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    selectedFileName = file.name;
    elements.fileLabel.textContent = file.name;
    elements.appleText.value = await file.text();
  });

  elements.appleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = elements.appleText.value.trim();
    if (!content) return showToast('Apple 文件内容为空', true);
    await runAction('正在解析 Apple 文件', () => postJson('/api/apple', {
      filename: selectedFileName || 'pasted.txt',
      content,
    }));
  });

  elements.appleUrlButton.addEventListener('click', async () => {
    const url = elements.appleUrl.value.trim();
    if (!url) return showToast('Apple Music 歌单链接为空', true);
    await runAction('正在抓取 Apple 歌单链接', () => postJson('/api/apple/url', { url }));
  });

  elements.appleBrowserOpenButton.addEventListener('click', async () => {
    await runAction('正在打开 Apple 登录窗口', () => postJson('/api/apple/browser/open', {
      url: elements.appleUrl.value.trim(),
    }));
  });

  elements.appleBrowserCaptureButton.addEventListener('click', async () => {
    await runAction('正在抓取 Apple 页面', () => postJson('/api/apple/browser/capture', {}));
  });

  elements.cookieForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runAction('正在保存 Cookie', () => postJson('/api/cookies', {
      qqCookie: elements.qqCookie.value,
      neteaseCookie: elements.neteaseCookie.value,
    }), () => {
      elements.qqCookie.value = '';
      elements.neteaseCookie.value = '';
    });
  });

  elements.qqBrowserOpenButton.addEventListener('click', async () => {
    await runAction('正在打开 QQ 登录窗口', () => postJson('/api/qq/browser/open', {}));
  });

  elements.qqBrowserCaptureButton.addEventListener('click', async () => {
    await runAction('正在抓取 QQ Cookie', async () => {
      await postJson('/api/qq/browser/capture', {});
      showToast('QQ Cookie 已保存，正在拉取快照');
      return postJson('/api/snapshot', {
        qq: true,
        netease: false,
        qqPlaylistId: elements.qqPlaylistId.value.trim(),
      });
    });
  });

  elements.snapshotButton.addEventListener('click', async () => {
    await runAction('正在拉取平台快照', () => postJson('/api/snapshot', {
      qqPlaylistId: elements.qqPlaylistId.value.trim(),
      neteasePlaylistId: elements.neteasePlaylistId.value.trim(),
    }));
  });

  elements.qqSnapshotButton.addEventListener('click', async () => {
    await runAction('正在拉取 QQ 快照', () => postJson('/api/snapshot', {
      qq: true,
      netease: false,
      qqPlaylistId: elements.qqPlaylistId.value.trim(),
    }));
  });

  elements.neteaseSnapshotButton.addEventListener('click', async () => {
    await runAction('正在拉取网易云快照', () => postJson('/api/snapshot', {
      qq: false,
      netease: true,
      neteasePlaylistId: elements.neteasePlaylistId.value.trim(),
    }));
  });

  elements.metadataButton.addEventListener('click', async () => {
    await runAction('正在补 Apple ISRC / MusicBrainz 别名', () => postJson('/api/metadata/enrich', {}));
  });

  elements.matchButton.addEventListener('click', async () => {
    await runAction('正在生成匹配统计', () => postJson('/api/match', {
      threshold: elements.threshold.value.trim(),
      reviewThreshold: elements.reviewThreshold.value.trim(),
    }));
  });

  elements.unifiedButton.addEventListener('click', async () => {
    activeFilter = 'sync-queue';
    await runAction('正在生成统一曲库', () => postJson('/api/unified/generate', {
      threshold: elements.threshold.value.trim(),
      reviewThreshold: elements.reviewThreshold.value.trim(),
    }), async () => loadUnifiedItems({ reset: true }));
  });

  elements.neteaseQrButton.addEventListener('click', startNeteaseQr);
  elements.refreshButton.addEventListener('click', refreshState);
  elements.loadMoreButton.addEventListener('click', () => loadUnifiedItems({ reset: false }));
  elements.aiReviewButton.addEventListener('click', runAiReview);
  elements.aiApplyButton.addEventListener('click', applyAiSuggestions);

  elements.summaryGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter;
    loadUnifiedItems({ reset: true });
  });

  elements.librarySearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadUnifiedItems({ reset: true }), 220);
  });

  elements.libraryList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-decision-type]');
    if (!button) return;
    await saveDecision(button);
  });
}

async function runAction(workingMessage, action, afterSuccess) {
  if (busy) return;
  setBusy(true);
  showToast(workingMessage);
  try {
    const payload = await action();
    if (!payload.ok) throw new Error(payload.error || '操作失败');
    renderState(payload.state);
    await afterSuccess?.(payload);
    showToast(payload.message || '完成');
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function refreshState() {
  try {
    const payload = await getJson('/api/state');
    if (payload.ok) {
      renderState(payload.state);
      await loadUnifiedItems({ reset: true });
    }
  } catch (error) {
    showToast(error.message || String(error), true);
  }
}

async function runAiReview() {
  if (busy) return;
  if (!elements.aiConsent.checked) {
    showToast('需要先确认会把全部待判断曲目信息发送到 DeepSeek', true);
    return;
  }
  const apiKey = elements.deepseekApiKey.value.trim();
  const limit = elements.aiBatchSize.value.trim();
  const model = elements.deepseekModel.value;
  const thinking = elements.aiThinking.checked;
  let processed = 0;
  let batches = 0;

  setBusy(true);
  showToast('正在全量请求 DeepSeek 生成建议');
  try {
    while (true) {
      const prefix = batches ? `AI 分析中：已完成 ${processed} 条` : 'AI 分析中：准备第一批';
      elements.aiSummary.textContent = `${prefix} / 批量 ${limit}`;
      const payload = await postJson('/api/ai/review', {
        filter: 'all-review',
        limit,
        model,
        apiKey,
        thinking,
      });
      if (!payload.ok) throw new Error(payload.error || 'AI 分析失败');
      renderState(payload.state);
      batches += 1;
      processed += payload.result?.decisionCount || 0;
      const remaining = payload.result?.remaining || 0;
      elements.aiSummary.textContent = `AI 分析中：已完成 ${processed} 条 / 剩余 ${remaining} 条`;
      await loadUnifiedItems({ reset: true });

      if (remaining <= 0) {
        showToast(`AI 全量分析完成：新增 ${processed} 条`);
        break;
      }
      if (!payload.result?.decisionCount) {
        throw new Error('DeepSeek 没有返回可保存的判断，已停止继续批量分析。');
      }
    }
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    if (apiKey) elements.deepseekApiKey.value = '';
    elements.aiConsent.checked = false;
    setBusy(false);
  }
}

async function applyAiSuggestions() {
  if (busy) return;
  const threshold = elements.aiApplyThreshold.value.trim() || '0.85';
  const overwrite = elements.aiApplyOverwrite.checked;
  await runAction('正在采纳高置信 AI 建议', () => postJson('/api/ai/apply', {
    threshold,
    overwrite,
  }), async (payload) => {
    renderApplySummary(payload.result);
    elements.aiApplyOverwrite.checked = false;
    await loadUnifiedItems({ reset: true });
  });
}

async function startNeteaseQr() {
  if (busy) return;
  setBusy(true);
  try {
    closeManualCookie('qr');
    elements.neteaseQrBox.hidden = false;
    elements.neteaseQrBox.classList.add('is-loading');
    elements.neteaseQrImage.hidden = true;
    elements.neteaseQrImage.removeAttribute('src');
    elements.neteaseQrPlaceholder.hidden = false;
    elements.neteaseQrTitle.textContent = '正在生成二维码';
    elements.neteaseQrHint.textContent = '正在向网易云请求登录二维码。';
    setAuthStage('qr');
    const payload = await postJson('/api/netease/qr/start', {});
    if (!payload.ok || !payload.qr?.qrimg) throw new Error(payload.error || '二维码生成失败');
    neteaseQrKey = payload.qr.key;
    elements.neteaseQrImage.src = payload.qr.qrimg;
    elements.neteaseQrImage.hidden = false;
    elements.neteaseQrPlaceholder.hidden = true;
    elements.neteaseQrBox.classList.remove('is-loading');
    elements.neteaseQrTitle.textContent = '等待扫码';
    elements.neteaseQrHint.textContent = '用网易云音乐 App 扫码并确认登录。';
    showToast('网易云二维码已生成');
    clearInterval(neteaseQrTimer);
    neteaseQrTimer = setInterval(checkNeteaseQr, 1800);
  } catch (error) {
    hideNeteaseQr({ stopPolling: true });
    setAuthStage('quote');
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function closeManualCookie(targetMode = '') {
  if (!elements.manualCookieDetails?.open) return;
  manualCloseTarget = targetMode;
  elements.manualCookieDetails.open = false;
}

function hideNeteaseQr(options = {}) {
  if (options.stopPolling) {
    clearInterval(neteaseQrTimer);
    neteaseQrTimer = 0;
    neteaseQrKey = '';
  }
  elements.neteaseQrBox.hidden = true;
  elements.neteaseQrBox.classList.remove('is-loading');
  elements.neteaseQrImage.hidden = true;
  elements.neteaseQrImage.removeAttribute('src');
  elements.neteaseQrPlaceholder.hidden = false;
}

function setAuthStage(mode) {
  if (!elements.authStage) return;
  elements.authStage.classList.toggle('manual-mode', mode === 'manual');
  elements.authStage.classList.toggle('qr-mode', mode === 'qr');
  elements.authStage.classList.toggle('quote-mode', mode === 'quote');
}

async function checkNeteaseQr() {
  if (!neteaseQrKey) return;
  try {
    const payload = await postJson('/api/netease/qr/check', { key: neteaseQrKey });
    const status = payload.status;
    elements.neteaseQrTitle.textContent = status.message || '等待扫码';
    if (status.code === 802) {
      elements.neteaseQrHint.textContent = '已扫码，请在手机上确认登录。';
    }
    if (status.done) {
      clearInterval(neteaseQrTimer);
      neteaseQrTimer = 0;
      neteaseQrKey = '';
      elements.neteaseQrHint.textContent = '网易云 Cookie 已保存，正在拉取红心快照。';
      renderState(payload.state);
      showToast('网易云登录成功');
      try {
        const snapshotPayload = await postJson('/api/snapshot', {
          qq: false,
          netease: true,
          neteasePlaylistId: elements.neteasePlaylistId.value.trim(),
        });
        renderState(snapshotPayload.state);
        showToast(snapshotPayload.message || '网易云快照已更新');
        elements.neteaseQrHint.textContent = '网易云快照已更新。';
      } catch (error) {
        elements.neteaseQrHint.textContent = 'Cookie 已保存，但快照拉取失败；可以稍后点“只拉网易云”。';
        showToast(error.message || String(error), true);
      }
    }
    if (status.code === 800) {
      clearInterval(neteaseQrTimer);
      neteaseQrTimer = 0;
      neteaseQrKey = '';
      elements.neteaseQrHint.textContent = '二维码已过期，请重新生成。';
    }
  } catch (error) {
    clearInterval(neteaseQrTimer);
    neteaseQrTimer = 0;
    showToast(error.message || String(error), true);
  }
}

function renderState(state) {
  currentState = state;
  setCount('apple', state.apple);
  setCount('qq', state.qq);
  setCount('netease', state.netease);

  elements.cookieState.textContent = [
    state.hasQqCookie ? 'QQ 已存' : 'QQ 未存',
    state.hasNeteaseCookie ? '网易云已存' : '网易云未存',
  ].join(' / ');
  setCredentialState(elements.qqCookieStatus, state.hasQqCookie);
  setCredentialState(elements.neteaseCookieStatus, state.hasNeteaseCookie);

  renderReportSummary(state.report, state.unified, state.decisions);
  renderAiSummary(state.ai, state.decisions);
}

function setCredentialState(node, saved) {
  if (!node) return;
  node.classList.toggle('saved', Boolean(saved));
  node.querySelector('strong').textContent = saved ? '本机已保存' : '待登录';
}

function setCount(kind, snapshot) {
  const countEl = elements[`${kind}Count`];
  countEl.textContent = snapshot?.count ?? 0;
  const row = countEl.closest('.status-row');
  const dot = row.querySelector('.dot');
  dot.className = `dot ${snapshot?.exists ? '' : 'empty'} ${snapshot?.skipped ? 'warn' : ''}`.trim();
  row.title = snapshot?.exists
    ? `ISRC ${snapshot.isrcCount || 0} / 别名 ${snapshot.aliasCount || 0} / MusicBrainz ${snapshot.musicbrainzCount || 0}`
    : '';
}

function renderReportSummary(report, unified, decisions) {
  elements.summaryGrid.innerHTML = '';
  if (!report?.exists && !unified?.exists) {
    elements.reportTime.textContent = '尚未生成';
    for (const item of [
      ['全部曲库', 0, 'all'],
      ['待同步', 0, 'sync-queue'],
      ['待判断', 0, 'review-queue'],
      ['已判断', 0, 'resolved'],
    ]) {
      elements.summaryGrid.appendChild(metric(item[0], item[1], item[2]));
    }
    return;
  }

  const latestTime = latestTimestamp(report?.generatedAt, unified?.generatedAt);
  elements.reportTime.textContent = latestTime ? new Date(latestTime).toLocaleString('zh-CN') : '尚未生成';
  const workflow = unified?.workflow || {};

  elements.summaryGrid.append(
    metric('全部曲库', unified?.totalUnified || 0, 'all'),
    metric('待同步', workflow.syncableClusters || 0, 'sync-queue'),
    metric('待判断', workflow.pendingReview ?? 0, 'review-queue'),
    metric('已判断', workflow.handledReview || 0, 'resolved'),
  );
  updateFilterButtons();
}

async function loadUnifiedItems(options = {}) {
  if (!currentState?.unified?.exists) {
    elements.libraryList.innerHTML = emptyState('先生成统一曲库，再处理版本/低置信条目。');
    elements.libraryResultCount.textContent = '暂无条目';
    elements.decisionSummary.textContent = '尚未选择';
    elements.loadMoreButton.hidden = true;
    updateFilterButtons();
    return;
  }

  if (options.reset) libraryOffset = 0;
  updateFilterButtons();
  const params = new URLSearchParams({
    filter: activeFilter,
    q: elements.librarySearch.value.trim(),
    offset: String(libraryOffset),
    limit: String(libraryLimit),
  });
  const payload = await getJson(`/api/unified/items?${params.toString()}`);
  renderDecisionSummary(payload.decisions);
  renderAiSummary({
    hasEnvKey: currentState?.ai?.hasEnvKey,
    model: currentState?.ai?.model,
    suggestions: payload.aiSuggestions || payload.suggestions || currentState?.ai?.suggestions,
  }, payload.decisions);
  elements.libraryResultCount.textContent = `${FILTER_LABELS[activeFilter] || '条目'}：${payload.total} 条`;
  renderLibraryItems(payload.items, { append: libraryOffset > 0 });
  libraryOffset += payload.items.length;
  elements.loadMoreButton.hidden = !payload.hasMore;
}

function renderLibraryItems(items, options = {}) {
  if (!options.append) elements.libraryList.innerHTML = '';
  if (!items.length && !options.append) {
    elements.libraryList.innerHTML = emptyState('没有符合条件的条目。');
    return;
  }

  const html = items.map((item) => (
    item.type === 'candidate' ? renderCandidateItem(item) : renderClusterItem(item)
  )).join('');
  elements.libraryList.insertAdjacentHTML('beforeend', html);
}

function renderClusterItem(item) {
  const missingBadges = item.missingPlatforms.length
    ? item.missingPlatforms.map((platform) => `<span class="platform-badge missing">待同步 ${platformLabel(platform)}</span>`).join('')
    : '<span class="platform-badge ok">三端已有</span>';
  const actionHtml = renderClusterActions(item);
  const conflictHtml = item.needsReview ? renderConflictBlock(item) : '';
  const versionHtml = renderVersionReviewBlock(item.versionReview);
  const suggestionHtml = renderAiSuggestion(item.aiSuggestion);
  return `
    <article class="library-card ${item.needsReview ? 'needs-review' : ''}">
      <div class="card-main">
        <div class="card-kicker">
          <span>${escapeHtml(item.id)}</span>
          <span>${escapeHtml(statusLabel(item.status))}</span>
        </div>
        <h3>${escapeHtml(item.title || '(无标题)')}</h3>
        <p>${escapeHtml(item.artist || '(未知歌手)')}</p>
        <div class="track-meta">
          <span>${escapeHtml(item.album || '无专辑')}</span>
          <span>${escapeHtml(item.duration || '')}</span>
        </div>
        <div class="badge-row">
          ${item.platforms.map((platform) => `<span class="platform-badge present">${platformLabel(platform)}</span>`).join('')}
          ${missingBadges}
        </div>
      </div>
      <div class="source-list">
        ${renderSourceRows(item.sources, item)}
      </div>
      <div class="sync-plan">${renderSyncPlan(item)}</div>
      ${conflictHtml}
      ${versionHtml}
      ${suggestionHtml}
      ${actionHtml}
    </article>
  `;
}

function renderClusterActions(item) {
  const reviewButtons = item.needsReview ? [
    decisionButton({
      label: '合并保留',
      type: 'cluster-review',
      id: item.id,
      action: 'same',
      active: item.decision?.reviewAction === 'same',
      tone: 'include',
    }),
    decisionButton({
      label: '分开保留',
      type: 'cluster-review',
      id: item.id,
      action: 'split',
      active: item.decision?.reviewAction === 'split',
      tone: 'exclude',
    }),
    decisionButton({
      label: '都不要',
      type: 'cluster-review',
      id: item.id,
      action: 'drop',
      active: item.decision?.reviewAction === 'drop',
      tone: 'danger',
    }),
  ] : [];
  const buttons = [...reviewButtons];
  if (!buttons.length) return '';
  return `<div class="choice-row">${buttons.join('')}</div>`;
}

function renderSyncPlan(item) {
  if (item.needsReview && !item.decision?.reviewAction) {
    return '同步计划：先判断版本关系，暂不进入补全队列。';
  }
  if (item.decision?.reviewAction === 'pick') {
    return '同步计划：只保留选中的版本，再补到缺失平台。';
  }
  if (item.decision?.reviewAction === 'split') {
    return '同步计划：已判定分开保留，等待拆分后再补全。';
  }
  if (item.decision?.reviewAction === 'drop') {
    return '同步计划：已从目标统一收藏中排除。';
  }
  if (!item.missingPlatforms.length) return '同步计划：三端已经都有。';
  return `同步计划：默认补到 ${item.missingPlatforms.map(platformLabel).join(' / ')}。`;
}

function renderConflictBlock(item) {
  if (!item.conflicts?.length) return '';
  const conflicts = item.conflicts.map((conflict) => `
    <div class="conflict-line">
      <strong>${platformLabel(conflict.platform)} x ${conflict.count}</strong>
      <span>${escapeHtml(conflict.tracks.map((track) => `${track.title} - ${track.artist}`).join('；'))}</span>
    </div>
  `).join('');
  return `<div class="conflict-box">${conflicts}</div>`;
}

function renderVersionReviewBlock(review) {
  if (!review) return '';
  const trackRows = (review.tracks || []).map((track) => `
    <div class="version-track">
      <strong>${platformLabel(track.platform)}</strong>
      <span>${escapeHtml([track.title, track.artist, track.duration, ...(track.tags || [])].filter(Boolean).join(' / '))}</span>
    </div>
  `).join('');
  return `
    <div class="version-box">
      <div class="version-reasons">${escapeHtml((review.reasons || []).join('；'))}</div>
      ${trackRows}
    </div>
  `;
}

function renderCandidateItem(item) {
  return `
    <article class="library-card candidate-card">
      <div class="candidate-score">${Math.round((item.score?.total || 0) * 100)}%</div>
      <div class="candidate-grid">
        ${renderCandidateEndpoint('来源', item.source, item.sourceCluster)}
        ${renderCandidateEndpoint('候选', item.target, item.targetCluster)}
      </div>
      <div class="score-grid">
        <span>标题 ${scoreText(item.score?.title)}</span>
        <span>歌手 ${scoreText(item.score?.artist)}</span>
        <span>专辑 ${scoreText(item.score?.album)}</span>
        <span>时长 ${scoreText(item.score?.duration)}</span>
      </div>
      ${renderAiSuggestion(item.aiSuggestion)}
      <div class="choice-row">
        ${decisionButton({
          label: '合并保留',
          type: 'candidate',
          key: item.key,
          action: 'merge',
          active: item.decision?.action === 'merge',
          tone: 'include',
        })}
        ${decisionButton({
          label: '分开都保留',
          type: 'candidate',
          key: item.key,
          action: 'separate',
          active: item.decision?.action === 'separate',
          tone: 'exclude',
        })}
        ${decisionButton({
          label: '只保留来源',
          type: 'candidate',
          key: item.key,
          action: 'keep-source',
          active: item.decision?.action === 'keep-source',
          tone: 'include',
        })}
        ${decisionButton({
          label: '只保留候选',
          type: 'candidate',
          key: item.key,
          action: 'keep-target',
          active: item.decision?.action === 'keep-target',
          tone: 'include',
        })}
        ${decisionButton({
          label: '都不要',
          type: 'candidate',
          key: item.key,
          action: 'drop',
          active: item.decision?.action === 'drop',
          tone: 'danger',
        })}
      </div>
    </article>
  `;
}

function renderCandidateEndpoint(label, endpoint, clusterId) {
  const track = endpoint?.track || {};
  return `
    <div class="candidate-endpoint">
      <div class="card-kicker">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(clusterId || '')}</span>
        <span>${platformLabel(endpoint?.platform)}</span>
      </div>
      <h3>${escapeHtml(track.title || '(无标题)')}</h3>
      <p>${escapeHtml(track.artist || '(未知歌手)')}</p>
      <div class="track-meta">
        <span>${escapeHtml(track.album || '无专辑')}</span>
        <span>${escapeHtml(track.duration || '')}</span>
      </div>
    </div>
  `;
}

function renderAiSuggestion(suggestion) {
  if (!suggestion) return '';
  const action = aiActionLabel(suggestion.recommendedAction);
  const relation = relationLabel(suggestion.relation);
  const confidence = Math.round(Number(suggestion.confidence || 0) * 100);
  const canonical = [suggestion.canonical?.title, suggestion.canonical?.artist, suggestion.canonical?.album]
    .filter(Boolean)
    .join(' / ');
  const preferred = [suggestion.preferred?.platform && platformLabel(suggestion.preferred.platform), suggestion.preferred?.title]
    .filter(Boolean)
    .join(' / ');
  return `
    <div class="ai-suggestion">
      <div class="ai-suggestion-head">
        <strong>AI 建议：${escapeHtml(action)}</strong>
        <span>${confidence}%</span>
      </div>
      ${relation ? `<div class="ai-canonical">判断：${escapeHtml(relation)}</div>` : ''}
      ${canonical ? `<div class="ai-canonical">${escapeHtml(canonical)}</div>` : ''}
      ${preferred ? `<div class="ai-canonical">推荐版本：${escapeHtml(preferred)}${suggestion.preferred?.reason ? `，${escapeHtml(suggestion.preferred.reason)}` : ''}</div>` : ''}
      <p>${escapeHtml(suggestion.reason || '')}</p>
    </div>
  `;
}

function aiActionLabel(action) {
  if (action === 'merge') return '合并';
  if (action === 'split_versions') return '按版本拆开';
  if (action === 'keep_separate') return '分开';
  return '人工确认';
}

function relationLabel(relation) {
  if (relation === 'same_recording') return '同曲同版本';
  if (relation === 'same_song_different_version') return '同曲不同版本';
  if (relation === 'different_song') return '不是同一首';
  if (relation === 'uncertain') return '证据不足';
  return '';
}

function renderSourceRows(sources = {}, item = null) {
  return Object.entries(sources).map(([platform, tracks]) => {
    const visible = tracks.slice(0, 4);
    const extra = tracks.length - visible.length;
    return `
      <div class="source-platform">
        <span class="source-label">${platformLabel(platform)}</span>
        <div>
          ${visible.map((track) => `
            <div class="source-track">
              <strong>${escapeHtml(track.title || '(无标题)')}</strong>
              <span>${escapeHtml([track.artist, track.album, track.duration].filter(Boolean).join(' / '))}</span>
              ${renderPickTrackButton(item, platform, track)}
            </div>
          `).join('')}
          ${extra > 0 ? `<div class="source-extra">还有 ${extra} 条同平台记录</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderPickTrackButton(item, platform, track) {
  if (!item?.needsReview) return '';
  const key = trackDecisionKey(platform, track);
  return decisionButton({
    label: '只保留这个版本',
    type: 'cluster-review',
    id: item.id,
    action: 'pick',
    selectedTrack: key,
    active: item.decision?.reviewAction === 'pick' && item.decision?.selectedTrack === key,
    tone: 'include mini',
  });
}

function decisionButton({ label, type, id, target, key, action, selectedTrack, active, tone }) {
  return `
    <button
      class="choice-button ${tone || ''} ${active ? 'active' : ''}"
      type="button"
      data-decision-type="${escapeAttr(type)}"
      data-id="${escapeAttr(id || '')}"
      data-target="${escapeAttr(target || '')}"
      data-key="${escapeAttr(key || '')}"
      data-selected-track="${escapeAttr(selectedTrack || '')}"
      data-action="${escapeAttr(action)}"
    >${escapeHtml(label)}</button>
  `;
}

async function saveDecision(button) {
  await runAction('正在保存选择', () => postJson('/api/unified/decision', {
    type: button.dataset.decisionType,
    id: button.dataset.id,
    target: button.dataset.target,
    key: button.dataset.key,
    selectedTrack: button.dataset.selectedTrack,
    action: button.dataset.action,
  }), async () => loadUnifiedItems({ reset: true }));
}

function renderDecisionSummary(decisions) {
  const candidateMerge = decisions?.candidateActions?.merge || 0;
  const candidateSeparate = decisions?.candidateActions?.separate || 0;
  const candidatePick = (decisions?.candidateActions?.['keep-source'] || 0)
    + (decisions?.candidateActions?.['keep-target'] || 0);
  const candidateDrop = decisions?.candidateActions?.drop || 0;
  const reviewSame = decisions?.reviewActions?.same || 0;
  const reviewSplit = decisions?.reviewActions?.split || 0;
  const reviewPick = decisions?.reviewActions?.pick || 0;
  const reviewDrop = decisions?.reviewActions?.drop || 0;
  elements.decisionSummary.textContent = `合并 ${reviewSame + candidateMerge} / 分开 ${reviewSplit + candidateSeparate} / 取一 ${reviewPick + candidatePick} / 不要 ${reviewDrop + candidateDrop}`;
}

function renderAiSummary(ai, decisions = {}) {
  const total = ai?.suggestions?.total || 0;
  const envText = ai?.hasEnvKey ? '环境变量已配置' : '未配置环境变量';
  const applied = Object.values(decisions?.reviewActions || {}).reduce((sum, value) => sum + value, 0)
    + Object.values(decisions?.candidateActions || {}).reduce((sum, value) => sum + value, 0);
  elements.aiSummary.textContent = total
    ? `AI 建议 ${total} 条 / 已采纳 ${applied} 条 / ${envText}`
    : `AI 尚未分析 / ${envText}`;
  if (elements.aiApplySummary) {
    const actions = ai?.suggestions?.actions || {};
    const merge = actions.merge || 0;
    const split = actions.split_versions || 0;
    const separate = actions.keep_separate || 0;
    elements.aiApplySummary.textContent = applied
      ? `已采纳 ${applied} 条；可调整阈值，或勾选覆盖后重跑。`
      : total
        ? `可按阈值采纳：合并 ${merge} / 拆版本 ${split} / 分开 ${separate}`
      : '先跑 AI 全量分析，再批量采纳高置信建议。';
  }
  if (ai?.model && elements.deepseekModel.value !== ai.model) {
    const option = [...elements.deepseekModel.options].find((item) => item.value === ai.model);
    if (option) elements.deepseekModel.value = ai.model;
  }
}

function renderApplySummary(result) {
  if (!elements.aiApplySummary || !result) return;
  const clusterTotal = (result.clusters?.same || 0) + (result.clusters?.split || 0);
  const candidateTotal = (result.candidates?.merge || 0) + (result.candidates?.separate || 0);
  const skipped = [
    result.skippedLowConfidence ? `低置信 ${result.skippedLowConfidence}` : '',
    result.skippedNeedsHuman ? `需人工 ${result.skippedNeedsHuman}` : '',
    result.skippedExisting ? `已有选择 ${result.skippedExisting}` : '',
  ].filter(Boolean).join(' / ');
  elements.aiApplySummary.textContent = `已采纳 ${result.applied || 0} 条：冲突 ${clusterTotal} / 低置信 ${candidateTotal}${skipped ? `；跳过 ${skipped}` : ''}`;
}

function updateFilterButtons() {
  for (const button of elements.summaryGrid.querySelectorAll('[data-filter]')) {
    button.classList.toggle('active', button.dataset.filter === activeFilter);
  }
}

function metric(label, value, filter = '') {
  const node = document.createElement(filter ? 'button' : 'div');
  node.className = `metric${filter ? ' metric-filter' : ''}`;
  if (filter) {
    node.type = 'button';
    node.dataset.filter = filter;
  }
  node.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 0)}</strong>`;
  return node;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform || '';
}

function trackDecisionKey(platform, track = {}) {
  const identity = track.id || track.mid || [
    track.title,
    track.artist,
    track.album,
    track.duration,
  ].filter(Boolean).join('|');
  return `${platform}:${identity}`;
}

function statusLabel(status) {
  const labels = {
    all_three: '三端都有',
    apple_qq: 'Apple + QQ',
    apple_netease: 'Apple + 网易云',
    qq_netease: 'QQ + 网易云',
    apple_only: '仅 Apple',
    qq_only: '仅 QQ',
    netease_only: '仅网易云',
  };
  return labels[status] || status || '';
}

function scoreText(value) {
  if (value === undefined || value === null) return '-';
  return `${Math.round(Number(value) * 100)}%`;
}

function latestTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || '';
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  for (const button of document.querySelectorAll('button')) {
    button.disabled = nextBusy;
  }
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? 'var(--red)' : 'var(--ink)';
  elements.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2800);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
