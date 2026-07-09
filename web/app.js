const $ = (selector) => document.querySelector(selector);

const PLATFORM_LABELS = {
  apple: 'Apple',
  qq: 'QQ',
  netease: '网易云',
};

const FILTER_LABELS = {
  'missing-apple': '缺 Apple',
  'sync-queue': '可补到平台',
  'missing-qq': '缺 QQ',
  'missing-netease': '缺网易云',
  'review-queue': '待判断',
  resolved: '已判断',
  'all-three': '三端都有',
  all: '全部曲库',
};

const AUTH_QUOTES = [
  '把歌单先放在同一张桌上，剩下的交给匹配。',
  '收藏夹不需要忠诚，只需要完整。',
  '先抓快照，再谈版本；先有证据，再做同步。',
  '同一首歌可以有很多名字，目标曲库只认清单。',
  '今天少漏一首歌，明天少一次手工补。',
];
const SNAPSHOT_STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
let authQuoteIndex = new Date().getDate() % AUTH_QUOTES.length;

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
  qqBrowserLoginBox: $('#qqBrowserLoginBox'),
  qqBrowserLoginTitle: $('#qqBrowserLoginTitle'),
  qqBrowserLoginHint: $('#qqBrowserLoginHint'),
  qqPlaylistPicker: $('#qqPlaylistPicker'),
  qqPlaylistRefreshButton: $('#qqPlaylistRefreshButton'),
  qqPlaylistList: $('#qqPlaylistList'),
  qqPlaylistHint: $('#qqPlaylistHint'),
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
  aiProgress: $('#aiProgress'),
  aiProgressTitle: $('#aiProgressTitle'),
  aiProgressDetail: $('#aiProgressDetail'),
  aiProgressTime: $('#aiProgressTime'),
  aiReviewButton: $('#aiReviewButton'),
  aiApplyThreshold: $('#aiApplyThreshold'),
  aiApplyOverwrite: $('#aiApplyOverwrite'),
  aiApplyButton: $('#aiApplyButton'),
  aiApplySummary: $('#aiApplySummary'),
  syncTarget: $('#syncTarget'),
  syncPlaylistId: $('#syncPlaylistId'),
  syncPlaylistName: $('#syncPlaylistName'),
  syncMinScore: $('#syncMinScore'),
  syncDeepseekApiKey: $('#syncDeepseekApiKey'),
  syncDeepseekModel: $('#syncDeepseekModel'),
  syncAiBatchSize: $('#syncAiBatchSize'),
  syncAiApplyThreshold: $('#syncAiApplyThreshold'),
  syncAiConsent: $('#syncAiConsent'),
  syncAiApplyOverwrite: $('#syncAiApplyOverwrite'),
  syncAiReviewButton: $('#syncAiReviewButton'),
  syncAiApplyButton: $('#syncAiApplyButton'),
  syncAiSummary: $('#syncAiSummary'),
  mirrorDeepseekApiKey: $('#mirrorDeepseekApiKey'),
  mirrorDeepseekModel: $('#mirrorDeepseekModel'),
  mirrorAiBatchSize: $('#mirrorAiBatchSize'),
  mirrorAiApplyThreshold: $('#mirrorAiApplyThreshold'),
  mirrorAiConsent: $('#mirrorAiConsent'),
  mirrorAiApplyOverwrite: $('#mirrorAiApplyOverwrite'),
  mirrorAiReviewButton: $('#mirrorAiReviewButton'),
  mirrorAiApplyButton: $('#mirrorAiApplyButton'),
  mirrorAiSummary: $('#mirrorAiSummary'),
  mirrorPlanButton: $('#mirrorPlanButton'),
  mirrorResolveButton: $('#mirrorResolveButton'),
  mirrorDryRunButton: $('#mirrorDryRunButton'),
  mirrorAddButton: $('#mirrorAddButton'),
  mirrorApplyButton: $('#mirrorApplyButton'),
  mirrorConvergenceButton: $('#mirrorConvergenceButton'),
  mirrorSummary: $('#mirrorSummary'),
  mirrorHealth: $('#mirrorHealth'),
  mirrorFilters: $('#mirrorFilters'),
  mirrorAllCount: $('#mirrorAllCount'),
  mirrorAddCount: $('#mirrorAddCount'),
  mirrorRemoveCount: $('#mirrorRemoveCount'),
  mirrorReviewCount: $('#mirrorReviewCount'),
  mirrorBlockedCount: $('#mirrorBlockedCount'),
  mirrorBulkActions: $('#mirrorBulkActions'),
  mirrorBulkSummary: $('#mirrorBulkSummary'),
  mirrorBulkKeepButton: $('#mirrorBulkKeepButton'),
  mirrorBulkSeparateButton: $('#mirrorBulkSeparateButton'),
  mirrorBulkClearButton: $('#mirrorBulkClearButton'),
  mirrorPager: $('#mirrorPager'),
  mirrorPageInfo: $('#mirrorPageInfo'),
  mirrorPrevButton: $('#mirrorPrevButton'),
  mirrorNextButton: $('#mirrorNextButton'),
  mirrorPlanList: $('#mirrorPlanList'),
  syncPlanButton: $('#syncPlanButton'),
  syncDryRunButton: $('#syncDryRunButton'),
  syncExecuteButton: $('#syncExecuteButton'),
  syncProgress: $('#syncProgress'),
  syncProgressTitle: $('#syncProgressTitle'),
  syncProgressDetail: $('#syncProgressDetail'),
  syncProgressTime: $('#syncProgressTime'),
  syncSummary: $('#syncSummary'),
  syncQueueCount: $('#syncQueueCount'),
  syncReadyCount: $('#syncReadyCount'),
  syncProblemCount: $('#syncProblemCount'),
  syncHandledCount: $('#syncHandledCount'),
  syncLastRun: $('#syncLastRun'),
  syncPager: $('#syncPager'),
  syncPageInfo: $('#syncPageInfo'),
  syncPrevButton: $('#syncPrevButton'),
  syncNextButton: $('#syncNextButton'),
  syncPlanList: $('#syncPlanList'),
  libraryResultCount: $('#libraryResultCount'),
  libraryPager: $('#libraryPager'),
  libraryPageInfo: $('#libraryPageInfo'),
  libraryPrevButton: $('#libraryPrevButton'),
  libraryNextButton: $('#libraryNextButton'),
  decisionSummary: $('#decisionSummary'),
  aiSummary: $('#aiSummary'),
  libraryList: $('#libraryList'),
  loadMoreButton: $('#loadMoreButton'),
  mirrorDeleteDialog: $('#mirrorDeleteDialog'),
  mirrorDeleteTarget: $('#mirrorDeleteTarget'),
  mirrorDeleteCount: $('#mirrorDeleteCount'),
  mirrorDeleteHint: $('#mirrorDeleteHint'),
  mirrorDeleteConfirmInput: $('#mirrorDeleteConfirmInput'),
  mirrorDeleteExpected: $('#mirrorDeleteExpected'),
  mirrorDeleteCancel: $('#mirrorDeleteCancel'),
  mirrorDeleteConfirm: $('#mirrorDeleteConfirm'),
  toast: $('#toast'),
};

let selectedFileName = '';
let busy = false;
let neteaseQrKey = '';
let neteaseQrTimer = 0;
let qqBrowserLoginTimer = 0;
let qqPlaylists = [];
let currentState = null;
let activeFilter = 'missing-qq';
let libraryOffset = 0;
let libraryLimit = 40;
let libraryTotal = 0;
let libraryRequestId = 0;
let searchTimer = 0;
let manualCloseTarget = '';
let currentSyncPlan = null;
let currentMirrorPlan = null;
let activeSyncFilter = 'all';
let activeMirrorFilter = 'all';
let syncPageIndex = 0;
let syncPageSize = 40;
let mirrorPageIndex = 0;
let mirrorPageSize = 30;
let syncProgressTimer = 0;
let syncProgressPollTimer = 0;
let syncProgressStartedAt = 0;
let aiProgressTimer = 0;
let aiProgressStartedAt = 0;

init();

function init() {
  if (elements.syncPlaylistName) elements.syncPlaylistName.value = defaultSyncPlaylistName();
  bindEvents();
  updateSyncTargetUi();
  resetAuthStage();
  renderLocalAuthQuote();
  refreshState();
}

function resetAuthStage() {
  if (elements.manualCookieDetails) elements.manualCookieDetails.open = false;
  hideQqBrowserLogin({ stopPolling: true });
  hideNeteaseQr({ stopPolling: true });
  setAuthStage('quote');
}

function renderLocalAuthQuote(options = {}) {
  if (!elements.authQuoteText) return;
  if (options.advance) {
    authQuoteIndex = (authQuoteIndex + 1) % AUTH_QUOTES.length;
  }
  elements.authQuoteText.textContent = AUTH_QUOTES[authQuoteIndex];
  if (elements.authQuoteFrom) {
    elements.authQuoteFrom.textContent = '本地提示';
  }
}

async function fetchAuthQuote() {
  renderLocalAuthQuote({ advance: true });
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
      hideQqBrowserLogin({ stopPolling: true });
      hideNeteaseQr({ stopPolling: true });
      setAuthStage('manual');
      return;
    }
    if (!elements.qqBrowserLoginBox.hidden) {
      setAuthStage('qr');
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
    await startQqBrowserLogin();
  });

  elements.qqBrowserCaptureButton.addEventListener('click', async () => {
    await runAction('正在抓取 QQ Cookie', async () => {
      await postJson('/api/qq/browser/capture', {});
      showToast('QQ Cookie 已保存，正在拉取快照');
      await refreshQqPlaylists({ silent: true });
      return postJson('/api/snapshot', {
        qq: true,
        netease: false,
        qqPlaylistId: elements.qqPlaylistId.value.trim(),
      });
    });
  });

  elements.qqPlaylistRefreshButton.addEventListener('click', async () => {
    await refreshQqPlaylists();
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
    activeFilter = targetMissingFilter();
    await runAction('正在生成统一曲库', () => postJson('/api/unified/generate', {
      threshold: elements.threshold.value.trim(),
      reviewThreshold: elements.reviewThreshold.value.trim(),
    }), async () => loadUnifiedItems({ reset: true }));
  });

  elements.neteaseQrButton.addEventListener('click', startNeteaseQr);
  elements.refreshButton.addEventListener('click', refreshState);
  elements.loadMoreButton.addEventListener('click', () => nextLibraryPage());
  elements.libraryPrevButton?.addEventListener('click', () => previousLibraryPage());
  elements.libraryNextButton?.addEventListener('click', () => nextLibraryPage());
  elements.syncPrevButton?.addEventListener('click', () => {
    if (syncPageIndex <= 0) return;
    syncPageIndex -= 1;
    renderWritePlan(currentSyncPlan);
  });
  elements.syncNextButton?.addEventListener('click', () => {
    syncPageIndex += 1;
    renderWritePlan(currentSyncPlan);
  });
  elements.mirrorPrevButton?.addEventListener('click', () => {
    if (mirrorPageIndex <= 0) return;
    mirrorPageIndex -= 1;
    renderMirrorPlan(currentMirrorPlan);
  });
  elements.mirrorNextButton?.addEventListener('click', () => {
    mirrorPageIndex += 1;
    renderMirrorPlan(currentMirrorPlan);
  });
  elements.aiReviewButton.addEventListener('click', runAiReview);
  elements.aiApplyButton.addEventListener('click', applyAiSuggestions);
  elements.mirrorPlanButton?.addEventListener('click', generateMirrorPlan);
  elements.mirrorResolveButton?.addEventListener('click', resolveMirrorAdds);
  elements.mirrorDryRunButton?.addEventListener('click', () => runMirrorApply(true));
  elements.mirrorAddButton?.addEventListener('click', () => runMirrorApply(false, ['add']));
  elements.mirrorApplyButton?.addEventListener('click', () => runMirrorApply(false, ['remove']));
  elements.mirrorConvergenceButton?.addEventListener('click', checkMirrorConvergence);
  elements.mirrorBulkKeepButton?.addEventListener('click', () => saveMirrorDecisionBatch('keep'));
  elements.mirrorBulkSeparateButton?.addEventListener('click', () => saveMirrorDecisionBatch('separate'));
  elements.mirrorBulkClearButton?.addEventListener('click', () => saveMirrorDecisionBatch('clear'));
  elements.mirrorAiReviewButton?.addEventListener('click', runMirrorAiReview);
  elements.mirrorAiApplyButton?.addEventListener('click', applyMirrorAiSuggestions);
  elements.syncPlanButton?.addEventListener('click', generateSyncPlan);
  elements.syncDryRunButton?.addEventListener('click', () => runPlatformSync(true));
  elements.syncExecuteButton?.addEventListener('click', () => runPlatformSync(false));
  elements.syncAiReviewButton?.addEventListener('click', runSyncAiReview);
  elements.syncAiApplyButton?.addEventListener('click', applySyncAiSuggestions);
  elements.syncTarget?.addEventListener('change', () => {
    updateSyncTargetUi();
    renderSyncAiSummary(currentState?.sync);
    loadUnifiedItems({ reset: true });
  });

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

  elements.syncPlanList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-sync-decision]');
    if (!button) return;
    await saveSyncDecision(button);
  });

  elements.mirrorPlanList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-mirror-decision]');
    if (!button) return;
    await saveMirrorDecision(button);
  });

  elements.syncSummary?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sync-filter]');
    if (!button) return;
    activeSyncFilter = button.dataset.syncFilter || 'all';
    syncPageIndex = 0;
    renderWritePlan(currentSyncPlan);
  });

  elements.mirrorFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mirror-filter]');
    if (!button) return;
    activeMirrorFilter = button.dataset.mirrorFilter || 'all';
    mirrorPageIndex = 0;
    renderMirrorPlan(currentMirrorPlan);
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
      await loadCurrentMirrorPlan();
      await loadCurrentSyncPlan();
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
  let requested = 0;
  let batches = 0;
  let totalToAnalyze = 0;

  setBusy(true);
  showToast('正在全量请求 DeepSeek 生成建议');
  startAiProgress('AI 全量分析', `第 1 批请求中：批量 ${limit || '默认'}，等待 DeepSeek 返回`);
  try {
    while (true) {
      const prefix = batches ? `AI 分析中：已完成 ${processed} 条` : 'AI 分析中：准备第一批';
      elements.aiSummary.textContent = `${prefix} / 批量 ${limit}`;
      updateAiProgress(
        batches ? `第 ${batches + 1} 批请求中：已完成 ${processed} 条，批量 ${limit || '默认'}` : `第 1 批请求中：批量 ${limit || '默认'}，等待 DeepSeek 返回`,
      );
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
      requested += payload.result?.itemCount || 0;
      processed += payload.result?.decisionCount || 0;
      totalToAnalyze = Math.max(totalToAnalyze, payload.result?.total || requested);
      const remaining = payload.result?.remaining || 0;
      const progressText = `本轮待请求 ${totalToAnalyze || requested} 条，已请求 ${requested} 条，已返回 ${processed} 条，剩余 ${remaining} 条`;
      elements.aiSummary.textContent = `AI 分析中：${progressText}`;
      updateAiProgress(`${progressText}；刚完成第 ${batches} 批`);
      await loadUnifiedItems({ reset: true });

      if (remaining <= 0) {
        showToast(`AI 全量分析完成：新增 ${processed} 条`);
        finishAiProgress(`AI 全量分析完成：请求 ${requested} 条，新增 ${processed} 条建议，剩余 0 条`);
        break;
      }
      if (!payload.result?.decisionCount) {
        throw new Error('DeepSeek 没有返回可保存的判断，已停止继续批量分析。');
      }
    }
  } catch (error) {
    showToast(error.message || String(error), true);
    finishAiProgress(error.message || String(error), { error: true });
  } finally {
    if (apiKey) elements.deepseekApiKey.value = '';
    elements.aiConsent.checked = false;
    setBusy(false);
  }
}

function startAiProgress(title, detail = '') {
  if (!elements.aiProgress) return;
  clearTimeout(finishAiProgress.timer);
  aiProgressStartedAt = Date.now();
  elements.aiProgress.hidden = false;
  elements.aiProgress.classList.add('running');
  elements.aiProgress.classList.remove('error');
  elements.aiProgressTitle.textContent = title;
  elements.aiProgressDetail.textContent = detail || '准备中';
  elements.aiProgressTime.textContent = '00:00';
  clearInterval(aiProgressTimer);
  aiProgressTimer = setInterval(updateAiProgressTime, 1000);
}

function updateAiProgress(detail, title = '') {
  if (!elements.aiProgress || elements.aiProgress.hidden) return;
  if (title) elements.aiProgressTitle.textContent = title;
  if (detail) elements.aiProgressDetail.textContent = detail;
  updateAiProgressTime();
}

function finishAiProgress(detail = '', options = {}) {
  if (!elements.aiProgress) return;
  clearInterval(aiProgressTimer);
  aiProgressTimer = 0;
  updateAiProgressTime();
  elements.aiProgress.classList.remove('running');
  elements.aiProgress.classList.toggle('error', Boolean(options.error));
  if (detail) elements.aiProgressDetail.textContent = detail;
  const delay = options.error ? 5200 : 3200;
  clearTimeout(finishAiProgress.timer);
  finishAiProgress.timer = setTimeout(() => {
    elements.aiProgress.hidden = true;
    elements.aiProgress.classList.remove('error');
  }, delay);
}

function updateAiProgressTime() {
  if (!elements.aiProgressTime || !aiProgressStartedAt) return;
  elements.aiProgressTime.textContent = formatElapsed(Date.now() - aiProgressStartedAt);
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

async function runSyncAiReview() {
  if (busy) return;
  if (!elements.syncAiConsent.checked) {
    showToast('需要先确认会把低置信候选发送到 DeepSeek', true);
    return;
  }
  const apiKey = elements.syncDeepseekApiKey.value.trim();
  const aiLimit = elements.syncAiBatchSize.value.trim() || '12';
  const batchSize = Math.min(50, Math.max(1, Number(aiLimit) || 12));
  let analyzed = 0;
  let saved = 0;
  let batches = 0;
  let totalToAnalyze = estimateSyncAiQueue(currentSyncPlan);

  setBusy(true);
  showToast('正在让 DeepSeek 判断低置信写入候选');
  startSyncProgress(
    'AI 判断低置信',
    totalToAnalyze
      ? `待分析 ${totalToAnalyze} 条，批量 ${batchSize}；已分析 0/${totalToAnalyze}`
      : `准备发送低置信候选，批量 ${batchSize}`,
    { determinate: true, done: 0, total: totalToAnalyze },
  );
  try {
    while (true) {
      const nextBatchSize = totalToAnalyze
        ? Math.min(batchSize, Math.max(0, totalToAnalyze - analyzed))
        : batchSize;
      const batchDetail = batches
        ? `第 ${batches + 1} 批请求中：已分析 ${analyzed}/${totalToAnalyze || '?'}，预计本批 ${nextBatchSize}`
        : `第 1 批请求中：已分析 ${analyzed}/${totalToAnalyze || '?'}，预计本批 ${nextBatchSize}`;
      elements.syncAiSummary.textContent = `写入 AI 分析中：${batchDetail}`;
      updateSyncProgress(batchDetail, '', { determinate: true, done: analyzed, total: totalToAnalyze });
      const payload = await postJson('/api/sync/ai/review', {
        ...syncRequestBody(),
        consent: true,
        apiKey,
        model: elements.syncDeepseekModel.value,
        thinking: true,
        aiLimit: batchSize,
      });
      if (!payload.ok) throw new Error(payload.error || '写入候选 AI 分析失败');
      renderState(payload.state);
      batches += 1;
      const itemCount = payload.result?.itemCount || 0;
      const decisionCount = payload.result?.decisionCount || 0;
      const remaining = payload.result?.remaining || 0;
      analyzed += itemCount;
      saved += decisionCount;
      totalToAnalyze = Math.max(totalToAnalyze, analyzed + remaining, payload.result?.total || 0);
      currentSyncPlan = payload.result?.plan;
      renderWritePlan(currentSyncPlan);
      const progressText = `已分析 ${analyzed}/${totalToAnalyze || analyzed}，已保存建议 ${saved} 条，剩余 ${remaining} 条`;
      elements.syncAiSummary.textContent = `写入 AI 分析中：${progressText}`;
      updateSyncProgress(`${progressText}；刚完成第 ${batches} 批`, '', {
        determinate: true,
        done: analyzed,
        total: totalToAnalyze,
      });
      if (remaining <= 0) {
        showToast(`写入候选 AI 分析完成：分析 ${analyzed} 条，新增 ${saved} 条`);
        finishSyncProgress(`AI 判断完成：已分析 ${analyzed}/${totalToAnalyze || analyzed}，新增 ${saved} 条建议，剩余 0 条`, {
          determinate: true,
          done: totalToAnalyze || analyzed,
          total: totalToAnalyze || analyzed,
        });
        break;
      }
      if (!payload.result?.decisionCount) {
        throw new Error('DeepSeek 没有返回可保存的写入判断，已停止继续批量分析。');
      }
    }
  } catch (error) {
    showToast(error.message || String(error), true);
    finishSyncProgress(error.message || String(error), { error: true });
  } finally {
    if (apiKey) elements.syncDeepseekApiKey.value = '';
    elements.syncAiConsent.checked = false;
    setBusy(false);
  }
}

function estimateSyncAiQueue(plan) {
  if (!plan?.items?.length) return 0;
  return plan.items.filter((item) => (
    item.status === 'low_score'
    && item.decisionKey
    && item.match?.track?.id
    && !item.decision
    && !item.aiSuggestion
  )).length;
}

async function applySyncAiSuggestions() {
  if (busy) return;
  const threshold = elements.syncAiApplyThreshold.value.trim() || '0.85';
  const overwrite = elements.syncAiApplyOverwrite.checked;
  await runAction('正在采纳写入候选 AI 建议', () => postJson('/api/sync/ai/apply', {
    ...syncRequestBody(),
    threshold,
    overwrite,
  }), async (payload) => {
    currentSyncPlan = payload.result?.plan;
    syncPageIndex = 0;
    renderWritePlan(currentSyncPlan);
    renderSyncAiApplySummary(payload.result);
    elements.syncAiApplyOverwrite.checked = false;
  });
}

async function loadCurrentSyncPlan() {
  if (!currentState?.sync?.plan?.exists) {
    currentSyncPlan = null;
    renderWritePlan(null);
    return;
  }
  try {
    const payload = await getJson('/api/sync/plan');
    if (payload.ok && payload.plan) {
      currentSyncPlan = payload.plan;
      if (elements.syncTarget && payload.plan.target) {
        elements.syncTarget.value = payload.plan.target;
        updateSyncTargetUi();
      }
      syncPageIndex = 0;
      renderWritePlan(currentSyncPlan);
    }
  } catch (error) {
    showToast(error.message || String(error), true);
  }
}

async function loadCurrentMirrorPlan() {
  if (!currentState?.mirror?.exists) {
    currentMirrorPlan = null;
    renderMirrorPlan(null);
    return;
  }
  try {
    const payload = await getJson('/api/mirror/plan');
    if (payload.ok && payload.plan) {
      currentMirrorPlan = payload.plan;
      mirrorPageIndex = 0;
      renderMirrorPlan(currentMirrorPlan);
    }
  } catch (error) {
    showToast(error.message || String(error), true);
  }
}

async function generateMirrorPlan() {
  if (busy) return;
  const target = selectedSyncTarget();
  if (target === 'apple') {
    showToast('Apple 是可信源，镜像目标只能选择 QQ 音乐或网易云', true);
    return;
  }
  setBusy(true);
  showToast('正在生成 Apple 镜像计划');
  try {
    const payload = await postJson('/api/mirror/plan', {
      target,
      threshold: elements.syncMinScore?.value.trim() || '0.82',
      reviewThreshold: elements.reviewThreshold?.value.trim() || '0.68',
    });
    if (!payload.ok) throw new Error(payload.error || '镜像计划生成失败');
    currentMirrorPlan = payload.plan || null;
    mirrorPageIndex = 0;
    renderMirrorPlan(currentMirrorPlan);
    renderState(payload.state);
    showToast(payload.message || 'Apple 镜像计划已生成');
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function runMirrorApply(dryRun, actions = []) {
  if (busy) return;
  const target = selectedSyncTarget();
  if (target === 'apple') {
    showToast('Apple 是可信源，镜像目标只能选择 QQ 音乐或网易云', true);
    return;
  }
  const planTarget = currentMirrorTarget() || target;
  const expected = `REMOVE ${planTarget.toUpperCase()}`;
  let confirmText = '';
  if (!dryRun && actions.includes('remove')) {
    const removeCounts = mirrorRemoveExecutionCounts(currentMirrorPlan || currentState?.mirror);
    if (!removeCounts.executable) {
      showToast(removeCounts.total
        ? '删除计划里没有可执行删除；缺少目标 id 的条目已阻塞。'
        : '当前镜像计划没有需要删除的条目。', true);
      return;
    }
    confirmText = await requestMirrorDeleteConfirmation({
      expected,
      removeCount: removeCounts.executable,
      blockedRemoveCount: removeCounts.blocked,
      target: planTarget,
      targetLabel: platformLabel(planTarget),
    });
    if (confirmText === null) return;
  }
  setBusy(true);
  const actionText = dryRun ? 'dry-run' : actions.includes('add') ? '新增' : actions.includes('remove') ? '删除' : '执行';
  showToast(`正在执行镜像 ${actionText}`);
  try {
    const payload = await postJson('/api/mirror/apply', {
      dryRun,
      actions,
      confirmText,
      playlistId: elements.syncPlaylistId?.value.trim() || '',
    });
    if (!payload.ok) throw new Error(payload.error || '镜像执行失败');
    renderState(payload.state);
    renderMirrorApplyResult(payload.result);
    showToast(payload.message || '镜像执行完成');
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function checkMirrorConvergence() {
  if (busy) return;
  const target = currentMirrorTarget() || selectedSyncTarget();
  if (target === 'apple') {
    showToast('Apple 是可信源，镜像目标只能选择 QQ 音乐或网易云', true);
    return;
  }
  setBusy(true);
  showToast('正在刷新目标快照并检查收敛');
  try {
    const payload = await postJson('/api/mirror/convergence', {
      target,
      playlistId: elements.syncPlaylistId?.value.trim() || '',
      refreshTarget: true,
      persist: true,
    });
    if (!payload.ok) throw new Error(payload.error || '收敛检查失败');
    currentMirrorPlan = payload.plan || payload.result?.plan || currentMirrorPlan;
    mirrorPageIndex = 0;
    renderState(payload.state);
    renderMirrorPlan(currentMirrorPlan);
    showToast(payload.message || '收敛检查完成');
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function currentMirrorTarget() {
  return String(currentMirrorPlan?.target?.platform || currentState?.mirror?.target?.platform || '').trim().toLowerCase();
}

function mirrorRemoveExecutionCounts(plan) {
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  if (operations.length) {
    return operations.reduce((acc, operation) => {
      if (operation?.action !== 'remove') return acc;
      acc.total += 1;
      if (operation.targetTrack?.id) acc.executable += 1;
      else acc.blocked += 1;
      return acc;
    }, { total: 0, executable: 0, blocked: 0 });
  }
  const total = Number(plan?.summary?.remove || 0);
  return { total, executable: total, blocked: 0 };
}

function requestMirrorDeleteConfirmation(options = {}) {
  const dialog = elements.mirrorDeleteDialog;
  const expected = String(options.expected || '').trim().toUpperCase();
  const targetLabel = options.targetLabel || platformLabel(options.target) || '目标平台';
  const removeCount = Number(options.removeCount || 0);
  const blockedRemoveCount = Number(options.blockedRemoveCount || 0);
  const blockedText = blockedRemoveCount ? `另有 ${blockedRemoveCount} 首缺少目标 id，已阻塞且不会提交。` : '';
  if (!dialog || typeof dialog.showModal !== 'function') {
    const value = window.prompt(`将按 Apple 可信源执行${targetLabel}镜像删除，可执行删除 ${removeCount} 首。${blockedText}新增仍需解析候选，不会在本次执行。请输入 ${expected} 确认。`, '');
    return Promise.resolve(value === null ? null : String(value || '').trim());
  }

  return new Promise((resolve) => {
    const input = elements.mirrorDeleteConfirmInput;
    const confirmButton = elements.mirrorDeleteConfirm;
    let settled = false;

    if (elements.mirrorDeleteTarget) elements.mirrorDeleteTarget.textContent = targetLabel;
    if (elements.mirrorDeleteCount) elements.mirrorDeleteCount.textContent = String(removeCount);
    if (elements.mirrorDeleteHint) {
      elements.mirrorDeleteHint.textContent = `将按 Apple 可信源执行${targetLabel}镜像删除。${blockedText}新增不会在本次执行；未解析新增和待判断条目会继续阻塞。`;
    }
    if (elements.mirrorDeleteExpected) elements.mirrorDeleteExpected.textContent = expected;
    if (input) input.value = '';
    if (confirmButton) confirmButton.disabled = true;

    const isConfirmed = () => String(input?.value || '').trim().toUpperCase() === expected;
    const refreshConfirmState = () => {
      if (confirmButton) confirmButton.disabled = !isConfirmed();
    };
    const close = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault?.();
      close(null);
    };
    const confirm = () => {
      if (!isConfirmed()) return;
      close(expected);
    };
    const backdropCancel = (event) => {
      if (event.target === dialog) close(null);
    };
    const cleanup = () => {
      input?.removeEventListener('input', refreshConfirmState);
      elements.mirrorDeleteCancel?.removeEventListener('click', cancel);
      confirmButton?.removeEventListener('click', confirm);
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('click', backdropCancel);
    };

    input?.addEventListener('input', refreshConfirmState);
    elements.mirrorDeleteCancel?.addEventListener('click', cancel);
    confirmButton?.addEventListener('click', confirm);
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('click', backdropCancel);
    dialog.showModal();
    input?.focus();
  });
}

async function resolveMirrorAdds() {
  if (busy) return;
  const target = selectedSyncTarget();
  if (target === 'apple') {
    showToast('Apple 是可信源，镜像目标只能选择 QQ 音乐或网易云', true);
    return;
  }
  setBusy(true);
  showToast('正在解析一批新增候选');
  try {
    const payload = await postJson('/api/mirror/resolve-adds', {
      limit: 50,
      searchLimit: target === 'qq' ? 12 : 10,
      threshold: elements.syncMinScore?.value.trim() || '0.82',
      reviewThreshold: elements.reviewThreshold?.value.trim() || '0.68',
    });
    if (!payload.ok) throw new Error(payload.error || '新增候选解析失败');
    currentMirrorPlan = payload.plan || currentMirrorPlan;
    mirrorPageIndex = 0;
    renderMirrorPlan(currentMirrorPlan);
    renderState(payload.state);
    const resolution = payload.plan?.addResolution || {};
    if (resolution.hasMore) {
      showToast(`${payload.message || '新增候选已解析'}；还有未解析批次`);
    } else {
      showToast(payload.message || '新增候选解析完成');
    }
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function runMirrorAiReview() {
  if (busy) return;
  if (!elements.mirrorAiConsent?.checked) {
    showToast('Need consent before sending mirror evidence to DeepSeek', true);
    return;
  }
  const apiKey = elements.mirrorDeepseekApiKey?.value.trim() || '';
  const aiLimit = elements.mirrorAiBatchSize?.value.trim() || '12';
  const batchSize = Math.min(50, Math.max(1, Number(aiLimit) || 12));
  let analyzed = 0;
  let saved = 0;
  let batches = 0;
  let totalToAnalyze = estimateMirrorAiQueue(currentMirrorPlan, currentState?.mirror);

  setBusy(true);
  showToast('Mirror AI review started');
  startSyncProgress(
    'Mirror AI review',
    totalToAnalyze
      ? `Pending ${totalToAnalyze}, batch ${batchSize}, reviewed 0/${totalToAnalyze}`
      : `Preparing mirror review batch ${batchSize}`,
    { determinate: true, done: 0, total: totalToAnalyze },
  );
  try {
    while (true) {
      const nextBatchSize = totalToAnalyze
        ? Math.min(batchSize, Math.max(0, totalToAnalyze - analyzed))
        : batchSize;
      const detail = `Batch ${batches + 1}: reviewed ${analyzed}/${totalToAnalyze || '?'}, requesting ${nextBatchSize}`;
      if (elements.mirrorAiSummary) elements.mirrorAiSummary.textContent = `Mirror AI reviewing: ${detail}`;
      updateSyncProgress(detail, '', { determinate: true, done: analyzed, total: totalToAnalyze });
      const payload = await postJson('/api/mirror/ai/review', {
        consent: true,
        apiKey,
        model: elements.mirrorDeepseekModel?.value || 'deepseek-v4-pro',
        thinking: true,
        aiLimit: batchSize,
      });
      if (!payload.ok) throw new Error(payload.error || 'Mirror AI review failed');
      batches += 1;
      const itemCount = payload.result?.itemCount || 0;
      const decisionCount = payload.result?.decisionCount || 0;
      const remaining = payload.result?.remaining || 0;
      analyzed += itemCount;
      saved += decisionCount;
      totalToAnalyze = Math.max(totalToAnalyze, analyzed + remaining, payload.result?.total || 0);
      currentMirrorPlan = payload.result?.plan || currentMirrorPlan;
      renderState(payload.state);
      renderMirrorPlan(currentMirrorPlan);
      const progressText = `reviewed ${analyzed}/${totalToAnalyze || analyzed}, saved ${saved}, remaining ${remaining}`;
      if (elements.mirrorAiSummary) elements.mirrorAiSummary.textContent = `Mirror AI reviewing: ${progressText}`;
      updateSyncProgress(progressText, '', {
        determinate: true,
        done: analyzed,
        total: totalToAnalyze,
      });
      if (remaining <= 0) {
        showToast(`Mirror AI review complete: ${saved} suggestions`);
        finishSyncProgress(`Mirror AI review complete: ${progressText}`, {
          determinate: true,
          done: totalToAnalyze || analyzed,
          total: totalToAnalyze || analyzed,
        });
        break;
      }
      if (!decisionCount) {
        throw new Error('DeepSeek returned no mirror suggestions; stopped batch review.');
      }
    }
  } catch (error) {
    showToast(error.message || String(error), true);
    finishSyncProgress(error.message || String(error), { error: true });
  } finally {
    if (apiKey && elements.mirrorDeepseekApiKey) elements.mirrorDeepseekApiKey.value = '';
    if (elements.mirrorAiConsent) elements.mirrorAiConsent.checked = false;
    setBusy(false);
  }
}

function estimateMirrorAiQueue(plan, mirrorState) {
  const reviewCount = Number(plan?.summary?.review ?? mirrorState?.summary?.review ?? 0);
  const suggested = Number(mirrorState?.aiSuggestions?.total || 0);
  return Math.max(0, reviewCount - suggested);
}

async function applyMirrorAiSuggestions() {
  if (busy) return;
  const threshold = elements.mirrorAiApplyThreshold?.value.trim() || '0.90';
  const overwrite = Boolean(elements.mirrorAiApplyOverwrite?.checked);
  await runAction('Applying mirror AI suggestions', () => postJson('/api/mirror/ai/apply', {
    target: currentMirrorPlan?.target?.platform || selectedSyncTarget(),
    threshold,
    overwrite,
  }), async (payload) => {
    currentMirrorPlan = payload.result?.plan || currentMirrorPlan;
    mirrorPageIndex = 0;
    renderState(payload.state);
    renderMirrorPlan(currentMirrorPlan);
    renderMirrorAiApplySummary(payload.result);
    if (elements.mirrorAiApplyOverwrite) elements.mirrorAiApplyOverwrite.checked = false;
  });
}

async function generateSyncPlan() {
  if (busy) return;
  const body = {
    ...syncRequestBody(),
    resolve: true,
  };
  setBusy(true);
  const targetLabel = selectedSyncTargetLabel();
  showToast('正在生成写入计划');
  const isAppleTarget = selectedSyncTarget() === 'apple';
  const detail = isAppleTarget
    ? 'Apple Music 会自动分段解析；已查过的 Catalog 查询会直接走本地缓存'
    : `正在搜索全量待同步曲目的${targetLabel}候选，并计算匹配分`;
  startSyncProgress('生成写入计划', detail, { poll: true });
  try {
    const payload = isAppleTarget
      ? await generateAppleSyncPlanBatches(body)
      : await postJson('/api/sync/plan', body);
    renderState(payload.state);
    currentSyncPlan = payload.plan;
    syncPageIndex = 0;
    renderWritePlan(payload.plan);
    const summary = payload.plan?.summary || {};
    finishSyncProgress(syncPlanFinishText(summary));
    showToast(payload.message || '写入计划已生成');
  } catch (error) {
    showToast(error.message || String(error), true);
    finishSyncProgress(error.message || String(error), { error: true });
  } finally {
    setBusy(false);
  }
}

async function generateAppleSyncPlanBatches(baseBody) {
  const chunkSize = 80;
  let offset = applePlanNextOffset(currentSyncPlan);
  let batch = 0;
  let latestPayload = null;

  while (true) {
    batch += 1;
    const nextBody = {
      ...baseBody,
      offset,
      limit: chunkSize,
      searchLimit: baseBody.searchLimit || 6,
    };
    const total = latestPayload?.plan?.searchQueue
      || currentState?.unified?.workflow?.syncableByPlatform?.apple
      || currentState?.unified?.missingByPlatform?.apple
      || 0;
    const done = total ? Math.min(offset, total) : 0;
    updateSyncProgress(`Apple Music 第 ${batch} 段解析中：已处理 ${done}/${total || '?'}；缓存命中会跳过网络搜索`, '', {
      determinate: Boolean(total),
      done,
      total,
    });
    latestPayload = await postJson('/api/sync/plan', nextBody);
    renderState(latestPayload.state);
    currentSyncPlan = latestPayload.plan;
    renderWritePlan(currentSyncPlan);
    if (syncPlanPaused(latestPayload.plan?.summary || {})) return latestPayload;

    const searchQueue = latestPayload.plan?.searchQueue || latestPayload.plan?.totalQueue || 0;
    offset = applePlanNextOffset(latestPayload.plan);
    updateSyncProgress(`Apple Music 第 ${batch} 段完成：已处理 ${Math.min(offset, searchQueue)}/${searchQueue || offset}`, '', {
      determinate: Boolean(searchQueue),
      done: Math.min(offset, searchQueue),
      total: searchQueue,
    });
    if (!latestPayload.plan?.hasMore) return latestPayload;
  }
}

function applePlanNextOffset(plan) {
  if (!plan?.items?.length || plan.target !== 'apple') return 0;
  const items = plan.items
    .filter((item) => !item.blocked)
    .sort((left, right) => Number(left.queueIndex || 0) - Number(right.queueIndex || 0));
  const indexed = items.map((item, index) => ({
    item,
    index: applePlanItemSearchIndex(item, index),
  }));
  const retry = indexed.find(({ item }) => ['error', 'rate_limited', 'deferred'].includes(item.status));
  if (retry) return retry.index;
  if (!indexed.length) return 0;
  return Math.max(...indexed.map(({ index }) => index)) + 1;
}

function applePlanItemSearchIndex(item, fallback) {
  const value = Number(item?.searchIndex);
  return Number.isFinite(value) ? value : fallback;
}

async function runPlatformSync(dryRun) {
  if (busy) return;
  const targetLabel = selectedSyncTargetLabel();
  if (!dryRun) {
    const ready = (currentSyncPlan?.summary?.ready || 0) + (currentSyncPlan?.summary?.accepted || 0);
    const confirmed = window.confirm(`将向${targetLabel}歌单写入当前计划里的高置信曲目${ready ? `（当前计划 ${ready} 首）` : ''}。确认继续？`);
    if (!confirmed) return;
  }
  const body = {
    ...syncRequestBody(),
    dryRun,
  };
  const title = dryRun ? `${targetLabel} Dry-run` : `写入${targetLabel}歌单`;
  const detail = dryRun
    ? '不会改动歌单，正在按正式流程计算全量计划里可写入的曲目'
    : `正在把已确认可写入曲目添加到${targetLabel}歌单`;
  setBusy(true);
  showToast(dryRun ? `正在执行${targetLabel} dry-run` : `正在写入${targetLabel}歌单`);
  startSyncProgress(title, detail, { poll: true });
  try {
    const payload = await postJson('/api/sync/write', body);
    renderState(payload.state);
    currentSyncPlan = payload.result?.plan;
    syncPageIndex = 0;
    renderWritePlan(currentSyncPlan);
    renderSyncRunResult(payload.result);
    const count = payload.result?.add?.requested || payload.result?.add?.added || 0;
    const summary = payload.result?.plan?.summary || {};
    finishSyncProgress(syncPlanPaused(summary)
      ? syncPlanFinishText(summary)
      : dryRun
        ? `Dry-run 完成：不会改动歌单，预计可写入 ${count} 首`
        : `写入请求完成：已请求添加 ${count} 首`);
    showToast(payload.message || '完成');
  } catch (error) {
    showToast(error.message || String(error), true);
    finishSyncProgress(error.message || String(error), { error: true });
  } finally {
    setBusy(false);
  }
}

function syncRequestBody() {
  const target = elements.syncTarget?.value || 'netease';
  const body = {
    target: elements.syncTarget?.value || 'netease',
    playlistId: elements.syncPlaylistId?.value.trim() || '',
    playlistName: elements.syncPlaylistName?.value.trim() || defaultSyncPlaylistName(),
    minScore: elements.syncMinScore?.value.trim() || '0.82',
    reviewScore: elements.reviewThreshold?.value.trim() || '0.68',
  };
  if (target === 'apple') {
    body.searchLimit = 6;
  }
  return body;
}

function selectedSyncTarget() {
  return elements.syncTarget?.value || 'netease';
}

function targetMissingFilter(target = selectedSyncTarget()) {
  if (target === 'apple') return 'missing-apple';
  if (target === 'netease') return 'missing-netease';
  return 'missing-qq';
}

function selectedSyncTargetLabel() {
  return PLATFORM_LABELS[selectedSyncTarget()] || '目标平台';
}

function updateSyncTargetUi() {
  const target = selectedSyncTarget();
  const label = selectedSyncTargetLabel();
  if (activeFilter === 'missing-apple' || activeFilter === 'missing-qq' || activeFilter === 'missing-netease') {
    activeFilter = targetMissingFilter(target);
    updateFilterButtons();
  }
  if (elements.syncDryRunButton) {
    elements.syncDryRunButton.lastChild.textContent = ` ${label} Dry-run`;
  }
  if (elements.syncExecuteButton) {
    elements.syncExecuteButton.lastChild.textContent = ` 写入${label}歌单`;
  }
  if (elements.mirrorPlanButton) {
    elements.mirrorPlanButton.disabled = busy || target === 'apple';
    elements.mirrorPlanButton.title = target === 'apple'
      ? 'Apple 是可信源，镜像目标请选择 QQ 音乐或网易云'
      : `生成 Apple -> ${label} 的镜像计划`;
  }
  for (const button of [elements.mirrorResolveButton, elements.mirrorDryRunButton, elements.mirrorAddButton, elements.mirrorApplyButton, elements.mirrorConvergenceButton]) {
    if (!button) continue;
    button.disabled = busy || target === 'apple';
    button.title = target === 'apple'
      ? 'Apple 是可信源，镜像目标请选择 QQ 音乐或网易云'
      : `按 Apple 可信源处理 ${label} 镜像计划`;
  }
  if (elements.syncPlaylistId) {
    elements.syncPlaylistId.placeholder = target === 'apple'
      ? '留空写入 Apple Favorite Songs；填歌单 ID 则写入指定歌单'
      : target === 'qq'
      ? '留空则新建歌单；填 201 可写入 QQ 我喜欢'
      : '留空则执行时新建私密歌单';
  }
}

async function startNeteaseQr() {
  if (busy) return;
  setBusy(true);
  try {
    closeManualCookie('qr');
    hideQqBrowserLogin({ stopPolling: true });
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

async function startQqBrowserLogin() {
  if (busy) return;
  setBusy(true);
  try {
    closeManualCookie('qr');
    hideNeteaseQr({ stopPolling: true });
    elements.qqBrowserLoginBox.hidden = false;
    elements.qqBrowserLoginBox.classList.add('is-loading');
    elements.qqBrowserLoginTitle.textContent = '正在打开 QQ 登录窗口';
    elements.qqBrowserLoginHint.textContent = '会打开 QQ 音乐官方页面；请在打开的窗口中扫码并确认。';
    setAuthStage('qr');
    const payload = await postJson('/api/qq/browser/open', {});
    if (!payload.ok) throw new Error(payload.error || 'QQ 登录窗口打开失败');
    renderState(payload.state);
    elements.qqBrowserLoginBox.classList.remove('is-loading');
    elements.qqBrowserLoginTitle.textContent = '等待 QQ 扫码';
    elements.qqBrowserLoginHint.textContent = '请在打开的 QQ 音乐窗口中扫码并确认；这里会自动检测并保存 Cookie。';
    showToast(payload.message || 'QQ 登录窗口已打开');
    clearInterval(qqBrowserLoginTimer);
    qqBrowserLoginTimer = setInterval(checkQqBrowserLogin, 1800);
    await checkQqBrowserLogin();
  } catch (error) {
    hideQqBrowserLogin({ stopPolling: true });
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

function hideQqBrowserLogin(options = {}) {
  if (options.stopPolling) {
    clearInterval(qqBrowserLoginTimer);
    qqBrowserLoginTimer = 0;
  }
  elements.qqBrowserLoginBox.hidden = true;
  elements.qqBrowserLoginBox.classList.remove('is-loading');
}

async function refreshQqPlaylists(options = {}) {
  try {
    const payload = await getJson('/api/qq/playlists');
    qqPlaylists = payload.playlists || [];
    renderQqPlaylists(qqPlaylists);
    const liked = qqPlaylists.find((playlist) => String(playlist.dirid) === '201')
      || qqPlaylists.find((playlist) => playlist.isLiked);
    if (!elements.qqPlaylistId.value.trim() && liked?.dirid) {
      elements.qqPlaylistId.value = liked.dirid;
    }
    elements.qqPlaylistHint.textContent = qqPlaylists.length
      ? `已读取 ${qqPlaylists.length} 个歌单，写入请优先使用 dirid。`
      : '没有读取到 QQ 歌单。';
    if (!options.silent) showToast(payload.message || 'QQ 歌单已读取');
    return qqPlaylists;
  } catch (error) {
    qqPlaylists = [];
    renderQqPlaylists([]);
    elements.qqPlaylistHint.textContent = 'QQ 歌单读取失败，请确认已扫码登录。';
    if (!options.silent) showToast(error.message || String(error), true);
    return [];
  }
}

function renderQqPlaylists(playlists) {
  elements.qqPlaylistList.innerHTML = '';
  if (!playlists.length) {
    elements.qqPlaylistList.innerHTML = emptyState('登录后读取 QQ 歌单 ID。');
    return;
  }

  for (const playlist of playlists) {
    const row = document.createElement('div');
    row.className = 'playlist-id-row';
    const preferredId = playlist.dirid || playlist.id || playlist.tid || '';
    const idParts = [
      playlist.dirid ? `dirid ${playlist.dirid}` : '',
      playlist.tid ? `tid ${playlist.tid}` : '',
      `${playlist.songCount || 0} 首`,
    ].filter(Boolean);
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(playlist.name || '(未命名歌单)')}${playlist.isLiked ? ' · 我喜欢' : ''}</strong>
        <span>${escapeHtml(idParts.join(' / '))}</span>
      </div>
    `;
    const button = document.createElement('button');
    button.className = 'ghost-button mini-button';
    button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>使用';
    button.addEventListener('click', () => {
      elements.qqPlaylistId.value = preferredId;
      showToast(`已填入 QQ 歌单 ID：${preferredId}`);
    });
    row.appendChild(button);
    elements.qqPlaylistList.appendChild(row);
  }
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

async function checkQqBrowserLogin() {
  try {
    const payload = await postJson('/api/qq/browser/check', {});
    const status = payload.status || {};
    elements.qqBrowserLoginTitle.textContent = status.message || '等待 QQ 登录';
    if (status.waiting) {
      elements.qqBrowserLoginHint.textContent = '请在打开的 QQ 音乐窗口中扫码并确认；后台正在检测登录态。';
      return;
    }
    if (status.done) {
      clearInterval(qqBrowserLoginTimer);
      qqBrowserLoginTimer = 0;
      elements.qqBrowserLoginHint.textContent = 'QQ Cookie 已保存，正在拉取 QQ 快照。';
      renderState(payload.state);
      showToast('QQ 登录成功');
      try {
        await refreshQqPlaylists({ silent: true });
        const snapshotPayload = await postJson('/api/snapshot', {
          qq: true,
          netease: false,
          qqPlaylistId: elements.qqPlaylistId.value.trim(),
        });
        renderState(snapshotPayload.state);
        showToast(snapshotPayload.message || 'QQ 快照已更新');
        elements.qqBrowserLoginHint.textContent = 'QQ 快照已更新。';
      } catch (error) {
        elements.qqBrowserLoginHint.textContent = 'Cookie 已保存，但快照拉取失败；可以稍后点“只拉 QQ”。';
        showToast(error.message || String(error), true);
      }
      return;
    }
    clearInterval(qqBrowserLoginTimer);
    qqBrowserLoginTimer = 0;
    elements.qqBrowserLoginHint.textContent = 'QQ 登录检测失败，请重新开始或使用手动 Cookie 兜底。';
  } catch (error) {
    clearInterval(qqBrowserLoginTimer);
    qqBrowserLoginTimer = 0;
    elements.qqBrowserLoginHint.textContent = 'QQ 登录检测失败，请重新开始或使用手动 Cookie 兜底。';
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
  elements.qqPlaylistPicker.hidden = !state.hasQqCookie;
  if (!state.hasQqCookie) {
    qqPlaylists = [];
    renderQqPlaylists([]);
    elements.qqPlaylistHint.textContent = '读取后可直接选择 dirid。';
  } else if (!qqPlaylists.length && !elements.qqPlaylistList.children.length) {
    renderQqPlaylists([]);
  }

  renderReportSummary(state.report, state.unified, state.decisions);
  renderAiSummary(state.ai, state.decisions);
  renderSyncState(state.sync);
  renderMirrorSummary(state.mirror);
  renderMirrorAiSummary(state.mirror);
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
  if (!['all', 'missing-apple', 'missing-qq', 'missing-netease', 'review-queue', 'all-three'].includes(activeFilter)) {
    activeFilter = targetMissingFilter();
  }
  if (!report?.exists && !unified?.exists) {
    elements.reportTime.textContent = '尚未生成';
    for (const item of [
      ['全部曲库', 0, 'all'],
      ['缺 Apple', 0, 'missing-apple'],
      ['缺 QQ', 0, 'missing-qq'],
      ['缺网易云', 0, 'missing-netease'],
      ['待判断', 0, 'review-queue'],
      ['三端都有', 0, 'all-three'],
    ]) {
      elements.summaryGrid.appendChild(metric(item[0], item[1], item[2]));
    }
    return;
  }

  const latestTime = latestTimestamp(report?.generatedAt, unified?.generatedAt);
  elements.reportTime.textContent = latestTime ? new Date(latestTime).toLocaleString('zh-CN') : '尚未生成';
  const workflow = unified?.workflow || {};
  const missing = unified?.missingByPlatform || {};

  elements.summaryGrid.append(
    metric('全部曲库', unified?.totalUnified || 0, 'all'),
    metric('缺 Apple', missing.apple || 0, 'missing-apple'),
    metric('缺 QQ', missing.qq || 0, 'missing-qq'),
    metric('缺网易云', missing.netease || 0, 'missing-netease'),
    metric('待判断', workflow.pendingReview ?? 0, 'review-queue'),
    metric('三端都有', unified?.allThree || 0, 'all-three'),
  );
  updateFilterButtons();
}

async function loadUnifiedItems(options = {}) {
  const requestId = ++libraryRequestId;
  if (!currentState?.unified?.exists) {
    elements.libraryList.innerHTML = emptyState('先生成统一曲库，再处理版本/低置信条目。');
    elements.libraryResultCount.textContent = '暂无条目';
    elements.decisionSummary.textContent = '尚未选择';
    updateLibraryPager({ total: 0, offset: 0, limit: libraryLimit, hasMore: false });
    elements.loadMoreButton.hidden = true;
    updateFilterButtons();
    return;
  }

  if (options.reset) {
    libraryOffset = 0;
  }
  updateFilterButtons();
  const params = new URLSearchParams({
    filter: activeFilter,
    q: elements.librarySearch.value.trim(),
    offset: String(libraryOffset),
    limit: String(libraryLimit),
  });
  const payload = await getJson(`/api/unified/items?${params.toString()}`);
  if (requestId !== libraryRequestId) return;
  if (payload.total > 0 && payload.offset >= payload.total) {
    libraryOffset = Math.max(0, Math.floor((payload.total - 1) / libraryLimit) * libraryLimit);
    return loadUnifiedItems();
  }
  renderDecisionSummary(payload.decisions);
  renderAiSummary({
    hasEnvKey: currentState?.ai?.hasEnvKey,
    model: currentState?.ai?.model,
    suggestions: payload.aiSuggestions || payload.suggestions || currentState?.ai?.suggestions,
  }, payload.decisions);
  libraryTotal = payload.total || 0;
  renderLibraryItems(payload.items);
  updateLibraryPager(payload);
}

function renderLibraryItems(items) {
  elements.libraryList.innerHTML = '';
  if (!items.length) {
    elements.libraryList.innerHTML = emptyState('没有符合条件的条目。');
    return;
  }

  const html = items.map((item) => (
    item.type === 'candidate' ? renderCandidateItem(item) : renderClusterItem(item)
  )).join('');
  elements.libraryList.innerHTML = html;
}

function updateLibraryPager(payload = {}) {
  const total = Number(payload.total || 0);
  const offset = Number(payload.offset || 0);
  const limit = Number(payload.limit || libraryLimit);
  const start = total ? offset + 1 : 0;
  const end = total ? Math.min(total, offset + (payload.items?.length || 0)) : 0;
  const label = FILTER_LABELS[activeFilter] || '条目';
  elements.libraryResultCount.textContent = `${label}：${total} 条`;
  if (elements.libraryPageInfo) {
    elements.libraryPageInfo.textContent = total ? `${start}-${end} / ${total}` : '0 / 0';
  }
  if (elements.libraryPager) elements.libraryPager.hidden = total <= limit;
  if (elements.libraryPrevButton) elements.libraryPrevButton.disabled = busy || offset <= 0;
  if (elements.libraryNextButton) elements.libraryNextButton.disabled = busy || !payload.hasMore;
  elements.loadMoreButton.hidden = true;
}

function previousLibraryPage() {
  if (busy || libraryOffset <= 0) return;
  libraryOffset = Math.max(0, libraryOffset - libraryLimit);
  loadUnifiedItems();
}

function nextLibraryPage() {
  if (busy || libraryOffset + libraryLimit >= libraryTotal) return;
  libraryOffset += libraryLimit;
  loadUnifiedItems();
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

function syncAiActionLabel(action) {
  if (action === 'add') return '写入';
  if (action === 'skip') return '跳过';
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
  }), async () => loadUnifiedItems());
}

async function saveSyncDecision(button) {
  if (busy) return;
  await runAction('正在保存写入候选选择', () => postJson('/api/sync/decision', {
      key: button.dataset.key,
      action: button.dataset.action,
      target: button.dataset.target,
      clusterId: button.dataset.clusterId,
      trackId: button.dataset.trackId,
    }), async (payload) => {
    currentSyncPlan = payload.result?.plan || currentSyncPlan;
    renderWritePlan(currentSyncPlan);
    renderSyncAiSummary(payload.state?.sync);
  });
}

async function saveMirrorDecision(button) {
  if (busy) return;
  await runAction('正在保存镜像复核选择', () => postJson('/api/mirror/decision', {
    key: button.dataset.key,
    action: button.dataset.action,
    target: button.dataset.target,
    operationId: button.dataset.operationId,
    reason: button.dataset.reason,
  }), async (payload) => {
    currentMirrorPlan = payload.result?.plan || currentMirrorPlan;
    mirrorPageIndex = 0;
    renderMirrorSummary(payload.state?.mirror || { exists: true, ...currentMirrorPlan });
    renderMirrorPlan(currentMirrorPlan);
  });
}

async function saveMirrorDecisionBatch(action) {
  if (busy) return;
  const items = buildVisibleMirrorBatchItems(action);
  if (!items.length) {
    showToast('当前页没有可批量处理的镜像复核条目', true);
    return;
  }
  const actionLabel = action === 'clear'
    ? '清除本页镜像复核'
    : action === 'keep'
      ? '本页复核视为同一首'
      : '本页复核视为不同曲目';
  await runAction(`正在批量处理：${actionLabel}`, () => postJson('/api/mirror/decisions', {
    action,
    target: currentMirrorPlan?.target?.platform || selectedSyncTarget(),
    items,
  }), async (payload) => {
    currentMirrorPlan = payload.result?.plan || currentMirrorPlan;
    mirrorPageIndex = 0;
    renderMirrorSummary(payload.state?.mirror || { exists: true, ...currentMirrorPlan });
    renderMirrorPlan(currentMirrorPlan);
  });
}

function buildVisibleMirrorBatchItems(action) {
  const page = currentMirrorPage(currentMirrorPlan).pageItems;
  return page
    .filter((operation) => isMirrorBatchEligible(operation, action))
    .map((operation) => ({
      key: operation.manualDecision?.key || operation.decisionKey || mirrorReviewDecisionKey(operation),
      target: currentMirrorPlan?.target?.platform || operation.targetTrack?.platform || selectedSyncTarget(),
      operationId: operation.id || '',
      reason: operation.reason || operation.manualDecision?.originalReason || '',
    }))
    .filter((item) => item.key);
}

function isMirrorBatchEligible(operation, action) {
  if (!operation) return false;
  if (action === 'clear') return Boolean(operation.manualDecision?.action);
  return operation.action === 'review' && !operation.manualDecision?.action;
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
  const aiApplied = decisions?.decisionSources?.aiApplied || 0;
  const manual = decisions?.decisionSources?.manual || 0;
  elements.decisionSummary.textContent = `合并 ${reviewSame + candidateMerge} / 分开 ${reviewSplit + candidateSeparate} / 取一 ${reviewPick + candidatePick} / 不要 ${reviewDrop + candidateDrop}；AI ${aiApplied} / 手工 ${manual}`;
}

function renderAiSummary(ai, decisions = {}) {
  const total = ai?.suggestions?.total || 0;
  const envText = ai?.hasEnvKey ? '环境变量已配置' : '未配置环境变量';
  const aiApplied = decisions?.decisionSources?.aiApplied || 0;
  const manual = decisions?.decisionSources?.manual || 0;
  elements.aiSummary.textContent = total
    ? `AI 建议 ${total} 条 / AI 采纳 ${aiApplied} 条 / 手工 ${manual} 条 / ${envText}`
    : `AI 尚未分析 / ${envText}`;
  if (elements.aiApplySummary) {
    const actions = ai?.suggestions?.actions || {};
    const merge = actions.merge || 0;
    const split = actions.split_versions || 0;
    const separate = actions.keep_separate || 0;
    elements.aiApplySummary.textContent = aiApplied || manual
      ? `AI 已采纳 ${aiApplied} 条，手工确认 ${manual} 条；可调整阈值，或勾选覆盖后重跑。`
      : total
        ? `可按阈值采纳：合并 ${merge} / 拆版本 ${split} / 分开 ${separate}`
      : '先跑 AI 全量分析，再批量采纳高置信建议。';
  }
  if (ai?.model && elements.deepseekModel.value !== ai.model) {
    const option = [...elements.deepseekModel.options].find((item) => item.value === ai.model);
    if (option) elements.deepseekModel.value = ai.model;
  }
}

function renderMirrorSummary(mirror) {
  if (!elements.mirrorSummary) return;
  if (!mirror?.exists) {
    elements.mirrorSummary.textContent = 'Apple 镜像计划尚未生成。删除只会先进入计划，不会直接执行。';
    renderMirrorHealth(null);
    return;
  }
  const target = mirror.target?.platform ? platformLabel(mirror.target.platform) : selectedSyncTargetLabel();
  const summary = mirror.summary || {};
  const decisions = mirror.decisions || {};
  const generatedAt = mirror.generatedAt ? new Date(mirror.generatedAt).toLocaleString('zh-CN') : '';
  const pieces = [
    `目标 ${target}`,
    `保留 ${summary.keep || 0}`,
    `新增 ${summary.add || 0}`,
    `已解析新增 ${summary.resolvedAdds || 0}`,
    `删除 ${summary.remove || 0}`,
    `待判断 ${summary.review || 0}`,
  ];
  if (decisions.total) pieces.push(`手工复核 ${decisions.total}`);
  elements.mirrorSummary.textContent = `${pieces.join(' / ')}。删除为破坏性计划项，当前不会直接执行。${generatedAt ? `生成于 ${generatedAt}` : ''}`;
  if (mirror.lastRun) {
    elements.mirrorSummary.textContent += ` 上次${mirror.lastRun.dryRun ? ' dry-run' : '执行'}：新增 ${mirror.lastRun.addResult?.added || 0}，删除请求 ${mirror.lastRun.remove?.executable || 0} / 已删除 ${mirror.lastRun.removeResult?.removed || 0}，未解析新增 ${mirror.lastRun.blocked?.unresolvedAdds || 0}。`;
  }
  renderMirrorHealth(mirror);
}

function renderMirrorHealth(mirror) {
  if (!elements.mirrorHealth) return;
  if (!mirror?.exists) {
    elements.mirrorHealth.className = 'mirror-health';
    elements.mirrorHealth.textContent = '生成镜像计划后会显示快照新鲜度和收敛状态。';
    return;
  }

  const summary = mirror.summary || {};
  const sourceAge = snapshotAgeDays(mirror.source?.fetchedAt);
  const targetAge = snapshotAgeDays(mirror.target?.fetchedAt);
  const targetPlatform = mirror.target?.platform || selectedSyncTarget();
  const sourceCurrent = currentState?.apple?.fetchedAt || '';
  const targetCurrent = currentState?.[targetPlatform]?.fetchedAt || '';
  const planUsesCurrentSnapshots = (!sourceCurrent || mirror.source?.fetchedAt === sourceCurrent)
    && (!targetCurrent || mirror.target?.fetchedAt === targetCurrent);
  const staleSnapshots = [sourceAge, targetAge].some((days) => days !== null && days > SNAPSHOT_STALE_DAYS);
  const deltaCount = (summary.add || 0) + (summary.remove || 0);
  const reviewCount = summary.review || 0;
  const lastRun = mirror.lastRun || null;
  const convergence = mirror.convergence || null;

  const messages = [];
  messages.push(formatSnapshotAge('Apple', sourceAge, mirror.source?.fetchedAt));
  messages.push(formatSnapshotAge(platformLabel(targetPlatform), targetAge, mirror.target?.fetchedAt));
  messages.push(planUsesCurrentSnapshots ? '计划基于当前本地快照' : '本地快照已更新，请重新生成镜像计划');
  if (deltaCount || reviewCount) {
    messages.push(`未收敛：新增 ${summary.add || 0} / 删除 ${summary.remove || 0} / 待判断 ${reviewCount}`);
  } else {
    messages.push('当前计划没有新增、删除或待判断项');
  }
  if (lastRun) {
    messages.push(lastRun.dryRun ? '最近一次是 dry-run；真实执行后仍需刷新快照并重新生成计划' : '执行后需刷新快照并重新生成计划证明收敛');
  }
  if (convergence) {
    messages.push(convergence.converged
      ? `收敛检查通过${convergence.refreshedTarget ? '（已刷新目标快照）' : '（本地快照）'}`
      : `收敛检查未通过：新增 ${convergence.add || 0} / 删除 ${convergence.remove || 0} / 待判断 ${convergence.review || 0}`);
  }

  const tone = !planUsesCurrentSnapshots || staleSnapshots
    ? 'stale'
    : convergence?.converged
      ? 'ok'
      : deltaCount || reviewCount
      ? 'pending'
      : 'ok';
  elements.mirrorHealth.className = `mirror-health ${tone}`;
  elements.mirrorHealth.innerHTML = messages
    .filter(Boolean)
    .map((message) => `<span>${escapeHtml(message)}</span>`)
    .join('');
}

function snapshotAgeDays(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / DAY_MS));
}

function formatSnapshotAge(label, ageDays, fetchedAt) {
  if (ageDays === null) return `${label} 快照时间未知`;
  const date = fetchedAt ? new Date(fetchedAt).toLocaleDateString('zh-CN') : '';
  return `${label} 快照 ${ageDays} 天前${date ? `（${date}）` : ''}`;
}

function renderMirrorPlan(plan) {
  if (!elements.mirrorPlanList) return;
  if (!plan) {
    renderMirrorPlanSummaryOnly(null);
    elements.mirrorPlanList.innerHTML = emptyState('先生成 Apple 镜像计划，再审查新增、删除和待判断条目。');
    updateMirrorPager(0);
    renderMirrorBulkActions(null, []);
    return;
  }
  renderMirrorPlanSummaryOnly(plan);
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  if (!operations.length) {
    elements.mirrorPlanList.innerHTML = emptyState('当前镜像计划没有可展示条目。');
    updateMirrorPager(0);
    renderMirrorBulkActions(plan, []);
    return;
  }
  const page = currentMirrorPage(plan);
  const filteredOperations = page.filteredOperations;
  if (!filteredOperations.length) {
    elements.mirrorPlanList.innerHTML = emptyState('这个筛选下暂时没有镜像条目。');
    updateMirrorPager(0);
    renderMirrorBulkActions(plan, []);
    return;
  }
  elements.mirrorPlanList.innerHTML = page.pageItems.map(renderMirrorOperationItem).join('');
  updateMirrorPager(filteredOperations.length, page.start, page.pageItems.length);
  renderMirrorBulkActions(plan, page.pageItems);
}

function currentMirrorPage(plan) {
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  const filteredOperations = filterMirrorOperations(operations);
  const totalPages = Math.max(1, Math.ceil(filteredOperations.length / mirrorPageSize));
  if (mirrorPageIndex >= totalPages) mirrorPageIndex = totalPages - 1;
  if (mirrorPageIndex < 0) mirrorPageIndex = 0;
  const start = mirrorPageIndex * mirrorPageSize;
  return {
    filteredOperations,
    start,
    pageItems: filteredOperations.slice(start, start + mirrorPageSize),
  };
}

function renderMirrorPlanSummaryOnly(plan) {
  const counts = mirrorDashboardCounts(plan);
  if (elements.mirrorAllCount) elements.mirrorAllCount.textContent = counts.all;
  if (elements.mirrorAddCount) elements.mirrorAddCount.textContent = counts.add;
  if (elements.mirrorRemoveCount) elements.mirrorRemoveCount.textContent = counts.remove;
  if (elements.mirrorReviewCount) elements.mirrorReviewCount.textContent = counts.review;
  if (elements.mirrorBlockedCount) elements.mirrorBlockedCount.textContent = counts.blocked;
  updateMirrorFilterCards();
}

function mirrorDashboardCounts(plan) {
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  if (operations.length) {
    return operations.reduce((acc, operation) => {
      acc.all += 1;
      if (operation.action === 'add') acc.add += 1;
      if (operation.action === 'remove') acc.remove += 1;
      if (operation.action === 'review') acc.review += 1;
      if (isBlockedMirrorOperation(operation)) acc.blocked += 1;
      return acc;
    }, { all: 0, add: 0, remove: 0, review: 0, blocked: 0 });
  }
  const summary = plan?.summary || {};
  return {
    all: summary.total || 0,
    add: summary.add || 0,
    remove: summary.remove || 0,
    review: summary.review || 0,
    blocked: summary.blocked || 0,
  };
}

function updateMirrorFilterCards() {
  if (!elements.mirrorFilters) return;
  if (!['all', 'add', 'remove', 'review', 'blocked'].includes(activeMirrorFilter)) activeMirrorFilter = 'all';
  for (const button of elements.mirrorFilters.querySelectorAll('[data-mirror-filter]')) {
    button.classList.toggle('active', button.dataset.mirrorFilter === activeMirrorFilter);
  }
}

function filterMirrorOperations(operations = []) {
  if (!['all', 'add', 'remove', 'review', 'blocked'].includes(activeMirrorFilter)) activeMirrorFilter = 'all';
  if (activeMirrorFilter === 'blocked') return operations.filter(isBlockedMirrorOperation);
  if (activeMirrorFilter === 'all') return operations;
  return operations.filter((operation) => operation.action === activeMirrorFilter);
}

function renderMirrorBulkActions(plan, pageItems = []) {
  if (!elements.mirrorBulkActions) return;
  const hasPlan = Boolean(plan?.operations?.length);
  const unresolvedReviewCount = pageItems.filter((operation) => isMirrorBatchEligible(operation, 'keep')).length;
  const manualDecisionCount = pageItems.filter((operation) => isMirrorBatchEligible(operation, 'clear')).length;
  const visible = hasPlan && (activeMirrorFilter === 'review' || unresolvedReviewCount || manualDecisionCount);
  elements.mirrorBulkActions.hidden = !visible;
  if (!visible) return;

  elements.mirrorBulkSummary.textContent = `当前页可批量复核 ${unresolvedReviewCount} 条，可清除 ${manualDecisionCount} 条`;
  elements.mirrorBulkKeepButton.disabled = busy || unresolvedReviewCount === 0;
  elements.mirrorBulkSeparateButton.disabled = busy || unresolvedReviewCount === 0;
  elements.mirrorBulkClearButton.disabled = busy || manualDecisionCount === 0;
}

function isBlockedMirrorOperation(operation) {
  if (!operation) return true;
  if (operation.action === 'review') return true;
  if (operation.status !== 'ready') return true;
  if (operation.action === 'add' && !operation.resolvedTargetTrack && !operation.targetTrack) return true;
  if (operation.action === 'remove' && !operation.targetTrack?.id) return true;
  return false;
}

function updateMirrorPager(total, start = 0, count = 0) {
  if (!elements.mirrorPager) return;
  const end = total ? Math.min(total, start + count) : 0;
  elements.mirrorPager.hidden = total <= mirrorPageSize;
  if (elements.mirrorPageInfo) {
    elements.mirrorPageInfo.textContent = total ? `${start + 1}-${end} / ${total}` : '0 / 0';
  }
  if (elements.mirrorPrevButton) elements.mirrorPrevButton.disabled = busy || start <= 0;
  if (elements.mirrorNextButton) elements.mirrorNextButton.disabled = busy || start + count >= total;
}

function renderMirrorOperationItem(operation) {
  const source = operation.sourceTrack;
  const target = operation.resolvedTargetTrack || operation.targetTrack || operation.candidateTrack;
  const targetLabel = operation.resolvedTargetTrack
    ? '已解析目标'
    : operation.targetTrack
      ? '目标现有'
      : operation.candidateTrack
        ? '候选'
        : '目标';
  const score = operation.resolvedScore || operation.score;
  const scoreTextValue = score ? `匹配分 ${scoreText(score.total ?? score)}` : '';
  const destructive = operation.destructive ? '<span class="mirror-danger-pill">破坏性</span>' : '';
  const reason = [operation.reason, operation.resolution?.reason].filter(Boolean).join(' / ');
  const blockedClass = isBlockedMirrorOperation(operation) ? 'blocked' : '';
  const resolution = renderMirrorResolution(operation);
  const decisionControls = renderMirrorDecisionControls(operation);
  const manualDecision = renderMirrorManualDecision(operation);
  return `
    <article class="mirror-item ${escapeAttr(operation.action || '')} ${escapeAttr(operation.status || '')} ${blockedClass}">
      <div class="mirror-item-head">
        <div class="card-kicker">
          <span>${escapeHtml(operation.id || '')}</span>
          <span>${escapeHtml(mirrorActionLabel(operation.action))}</span>
          ${destructive}
        </div>
        <span class="sync-status ${escapeAttr(operation.status || '')}">${escapeHtml(mirrorStatusLabel(operation.status))}</span>
      </div>
      <div class="mirror-track-grid">
        ${renderMirrorTrack('Apple', source)}
        ${renderMirrorTrack(targetLabel, target)}
      </div>
      ${resolution}
      ${manualDecision}
      ${decisionControls}
      <div class="mirror-item-meta">
        ${scoreTextValue ? `<span>${escapeHtml(scoreTextValue)}</span>` : ''}
        ${reason ? `<span>${escapeHtml(reason)}</span>` : ''}
        ${operation.message ? `<span>${escapeHtml(operation.message)}</span>` : ''}
      </div>
    </article>
  `;
}

function renderMirrorManualDecision(operation) {
  const decision = operation.manualDecision;
  if (!decision?.action) return '';
  const action = decision.action === 'keep' ? '已手工确认同一首' : '已手工确认不同曲目';
  const original = decision.originalReason ? `原复核原因：${decision.originalReason}` : '';
  return `
    <div class="mirror-manual-decision">
      <strong>${escapeHtml(action)}</strong>
      ${original ? `<span>${escapeHtml(original)}</span>` : ''}
    </div>
  `;
}

function renderMirrorDecisionControls(operation) {
  const decisionKey = operation.manualDecision?.key || operation.decisionKey || mirrorReviewDecisionKey(operation);
  if (!decisionKey) return '';
  if (operation.manualDecision?.action) {
    return `
      <div class="mirror-decision-row">
        ${mirrorDecisionButton({
      label: '清除复核',
      operation,
      key: decisionKey,
      action: 'clear',
      tone: 'ghost',
    })}
      </div>
    `;
  }
  if (operation.action !== 'review') return '';
  return `
    <div class="mirror-decision-row">
      ${mirrorDecisionButton({
    label: '视为同一首',
    operation,
    key: decisionKey,
    action: 'keep',
    tone: 'include',
  })}
      ${mirrorDecisionButton({
    label: '视为不同，按 Apple 镜像',
    operation,
    key: decisionKey,
    action: 'separate',
    tone: 'danger',
  })}
    </div>
  `;
}

function mirrorDecisionButton({ label, operation, key, action, tone }) {
  const target = currentMirrorPlan?.target?.platform || operation.targetTrack?.platform || selectedSyncTarget();
  return `
    <button
      class="choice-button ${tone || ''}"
      type="button"
      data-mirror-decision="true"
      data-key="${escapeAttr(key || '')}"
      data-action="${escapeAttr(action)}"
      data-target="${escapeAttr(target)}"
      data-operation-id="${escapeAttr(operation.id || '')}"
      data-reason="${escapeAttr(operation.reason || operation.manualDecision?.originalReason || '')}"
    >${escapeHtml(label)}</button>
  `;
}

function mirrorReviewDecisionKey(operation = {}) {
  return [
    'review',
    operation.manualDecision?.originalReason || operation.reason || '',
    mirrorDecisionTrackIdentity(operation.sourceTrack),
    mirrorDecisionTrackIdentity(operation.targetTrack || operation.candidateTrack),
  ].join('|');
}

function mirrorDecisionTrackIdentity(track) {
  if (!track) return 'none';
  const platform = track.platform || '';
  const providerId = track.id || track.mid || track.isrc || '';
  const fallback = normalizeDecisionText([
    track.title || '',
    track.artist || '',
    track.album || '',
    track.durationMs || track.duration || '',
  ].join(' '));
  return [platform, providerId, fallback].join(':');
}

function normalizeDecisionText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+-\s+.*$/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e'"`’‘“”()[\]{}【】（）<>《》,，.。!！?？:：;；|/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMirrorResolution(operation) {
  if (!operation?.resolution && !operation?.alternatives?.length && !operation?.resolvedTargetTrack) return '';
  const alternatives = Array.isArray(operation.alternatives) ? operation.alternatives : [];
  const alternativeItems = alternatives.slice(0, 5).map((track, index) => `
    <li>
      <span>${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
      <strong>${escapeHtml(track.title || '(无标题)')}</strong>
      <small>${escapeHtml([track.artist, track.album, track.duration].filter(Boolean).join(' / ') || '无歌手/专辑信息')}</small>
      <small>${escapeHtml([track.id ? `ID ${track.id}` : '', track.mid ? `MID ${track.mid}` : '', track.isrc ? `ISRC ${track.isrc}` : ''].filter(Boolean).join(' / ') || '无平台 ID')}</small>
    </li>
  `).join('');
  const resolutionMessage = operation.resolution?.message || '';
  const resolved = operation.resolvedTargetTrack
    ? `已解析为 ${operation.resolvedTargetTrack.title || '(无标题)'}`
    : operation.candidateTrack
      ? `候选 ${operation.candidateTrack.title || '(无标题)'}`
      : '尚未解析到可执行目标';
  return `
    <div class="mirror-resolution">
      <div class="mirror-resolution-head">
        <strong>${escapeHtml(resolved)}</strong>
        <span>${escapeHtml(operation.resolution?.reason || operation.status || '')}</span>
      </div>
      ${resolutionMessage ? `<p>${escapeHtml(resolutionMessage)}</p>` : ''}
      ${alternativeItems ? `
        <details class="mirror-alternatives" open>
          <summary>备选候选 ${alternatives.length}</summary>
          <ol>${alternativeItems}</ol>
        </details>
      ` : ''}
    </div>
  `;
}

function renderMirrorTrack(label, track) {
  if (!track) {
    return `
      <div class="mirror-track empty">
        <span>${escapeHtml(label)}</span>
        <strong>无对应曲目</strong>
        <small>该侧为空</small>
      </div>
    `;
  }
  const title = track.title || '(无标题)';
  const subtitle = [track.artist, track.album, track.duration].filter(Boolean).join(' / ');
  const ids = [
    track.platform ? platformLabel(track.platform) : '',
    track.id ? `ID ${track.id}` : '',
    track.mid ? `MID ${track.mid}` : '',
    track.isrc ? `ISRC ${track.isrc}` : '',
  ].filter(Boolean).join(' / ');
  return `
    <div class="mirror-track">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(subtitle || '无歌手/专辑信息')}</small>
      <small>${escapeHtml(ids || '无平台 ID')}</small>
    </div>
  `;
}

function mirrorActionLabel(action) {
  if (action === 'keep') return '保留';
  if (action === 'add') return '新增';
  if (action === 'remove') return '删除';
  if (action === 'review') return '待判断';
  return action || '未知';
}

function mirrorStatusLabel(status) {
  if (status === 'ready') return '可执行';
  if (status === 'needs_resolution') return '待解析';
  if (status === 'needs_review') return '待判断';
  if (status === 'not_found') return '未命中';
  return status || '未知';
}

function renderMirrorApplyResult(result) {
  if (!elements.mirrorSummary || !result) return;
  const add = result.add || {};
  const remove = result.remove || {};
  const removeResult = result.removeResult || {};
  const blocked = result.blocked || {};
  elements.mirrorSummary.textContent = result.dryRun
    ? `镜像 dry-run：新增 ${add.requested || 0}（未解析 ${add.blocked || 0}），删除 ${remove.executable || 0}，待判断 ${result.review?.blocked || 0}。`
    : `镜像执行：平台确认新增 ${result.addResult?.added || 0}，删除请求 ${remove.executable || 0}，平台确认删除 ${removeResult.removed || 0}；未解析新增 ${blocked.unresolvedAdds || 0}，待判断 ${blocked.reviewItems || 0}。`;
}

function renderMirrorAiSummary(mirror) {
  if (!elements.mirrorAiSummary) return;
  const suggestions = mirror?.aiSuggestions || {};
  const actions = suggestions.actions || {};
  if (!suggestions.total) {
    elements.mirrorAiSummary.textContent = 'Mirror AI has not reviewed candidates.';
    return;
  }
  const last = suggestions.lastBatch;
  const lastText = last?.reviewedAt ? ` Last batch: ${new Date(last.reviewedAt).toLocaleString('zh-CN')}, ${last.itemCount || 0} items.` : '';
  elements.mirrorAiSummary.textContent = [
    `Mirror AI suggestions: ${suggestions.total}`,
    `keep ${actions.keep || 0}`,
    `separate ${actions.separate || 0}`,
    `needs human ${actions.needs_human || 0}`,
    `guarded ${suggestions.guarded || 0}.`,
    lastText,
  ].join(' / ');
}

function renderMirrorAiApplySummary(result = {}) {
  if (!elements.mirrorAiSummary || !result) return;
  elements.mirrorAiSummary.textContent = [
    `Applied ${result.applied || 0} mirror AI decisions`,
    `keep ${result.kept || 0}`,
    `separate ${result.separated || 0}`,
    `skipped low confidence ${result.skippedLowConfidence || 0}`,
    `needs human ${result.skippedNeedsHuman || 0}`,
  ].join(' / ');
}

function syncReadyCount(summary = {}) {
  return (summary.ready || 0) + (summary.accepted || 0);
}

function syncReviewCount(summary = {}) {
  return (summary.low_score || 0)
    + (summary.needs_review || 0)
    + (summary.pending_search || 0)
    + (summary.searching || 0)
    + (summary.rate_limited || 0)
    + (summary.deferred || 0)
    + (summary.error || 0);
}

function syncHandledCount(summary = {}) {
  return (summary.already_present || 0)
    + (summary.rejected || 0)
    + (summary.excluded_by_decision || 0)
    + (summary.not_found || 0);
}

function syncProblemCount(summary = {}) {
  return (summary.low_score || 0)
    + (summary.not_found || 0)
    + (summary.needs_review || 0)
    + (summary.excluded_by_decision || 0)
    + (summary.rate_limited || 0)
    + (summary.deferred || 0)
    + (summary.error || 0);
}

function renderSyncAiSummary(sync) {
  if (!elements.syncAiSummary) return;
  const suggestions = sync?.aiSuggestions;
  const decisions = sync?.decisions;
  const total = suggestions?.total || 0;
  const add = suggestions?.actions?.add || 0;
  const skip = suggestions?.actions?.skip || 0;
  const needsHuman = suggestions?.actions?.needs_human || 0;
  const accepted = decisions?.actions?.accept || 0;
  const rejected = decisions?.actions?.reject || 0;
  const aiApplied = decisions?.sources?.aiApplied || 0;
  const manual = decisions?.sources?.manual || 0;
  const env = currentState?.ai?.hasEnvKey ? '环境变量已配置' : '未配置环境变量';
  const errorText = sync?.errors?.active
    ? `；当前搜索错误 ${sync.errors.active} 条${sync.errors.last?.title ? `：${sync.errors.last.title} - ${sync.errors.last.error}` : ''}`
    : sync?.errors?.total
      ? `；历史错误 ${sync.errors.total} 条，当前已恢复`
      : '';
  const cache = sync?.appleCatalogCache;
  const appleCacheText = selectedSyncTarget() === 'apple' && cache
    ? `；Apple 候选缓存 ${cache.queries || 0} 个查询 / ${cache.uniqueSongs || 0} 首候选`
    : '';
  elements.syncAiSummary.textContent = total
    ? `写入 AI：建议 ${total} 条，写入 ${add} / 跳过 ${skip} / 人工 ${needsHuman}；已确认 写入 ${accepted} / 跳过 ${rejected}（AI ${aiApplied} / 手工 ${manual}）；${env}`
    : `写入 AI 尚未分析低置信候选；${env}`;
  elements.syncAiSummary.textContent += appleCacheText + errorText;
}

function renderSyncState(sync) {
  if (!elements.syncQueueCount) return;
  const plan = sync?.plan;
  const lastRun = sync?.lastRun;
  elements.syncLastRun.textContent = lastRun ? syncRunCountText(lastRun) : '暂无';
  renderSyncAiSummary(sync);
  if (!plan?.exists) renderWritePlan(null);
  else renderWritePlanSummaryOnly(plan);
}

function renderWritePlan(plan) {
  if (!elements.syncPlanList) return;
  if (!plan) {
    renderWritePlanSummaryOnly(null);
    elements.syncPlanList.innerHTML = emptyState('先生成写入计划，再查看候选曲目。');
    updateSyncPager(0);
    return;
  }
  renderWritePlanSummaryOnly(plan);
  if (!plan.items?.length) {
    elements.syncPlanList.innerHTML = emptyState('当前没有可展示的写入计划。');
    updateSyncPager(0);
    return;
  }
  const filteredItems = filterSyncPlanItems(plan.items);
  if (!filteredItems.length) {
    elements.syncPlanList.innerHTML = emptyState('这个筛选下暂时没有条目。');
    updateSyncPager(0);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / syncPageSize));
  if (syncPageIndex >= totalPages) syncPageIndex = totalPages - 1;
  if (syncPageIndex < 0) syncPageIndex = 0;
  const start = syncPageIndex * syncPageSize;
  const pageItems = filteredItems.slice(start, start + syncPageSize);
  const renderedItems = pageItems.map(renderSyncPlanItem).join('');
  elements.syncPlanList.innerHTML = renderedItems;
  updateSyncPager(filteredItems.length, start, pageItems.length);
}

function renderWritePlanSummaryOnly(plan) {
  const counts = syncDashboardCounts(plan);
  elements.syncQueueCount.textContent = counts.all;
  elements.syncReadyCount.textContent = counts.writeable;
  elements.syncProblemCount.textContent = counts.review;
  if (elements.syncHandledCount) elements.syncHandledCount.textContent = counts.handled;
  updateSyncSummaryCards();
}

function updateSyncPager(total, start = 0, count = 0) {
  if (!elements.syncPager) return;
  const end = total ? Math.min(total, start + count) : 0;
  elements.syncPager.hidden = total <= syncPageSize;
  if (elements.syncPageInfo) {
    elements.syncPageInfo.textContent = total ? `${start + 1}-${end} / ${total}` : '0 / 0';
  }
  if (elements.syncPrevButton) elements.syncPrevButton.disabled = busy || start <= 0;
  if (elements.syncNextButton) elements.syncNextButton.disabled = busy || start + count >= total;
}

function renderSyncPlanItem(item) {
  const match = item.match?.track;
  const targetLabel = PLATFORM_LABELS[item.target || match?.platform || selectedSyncTarget()] || '目标平台';
  const sourceLabel = item.source?.platform
    ? platformLabel(item.source.platform)
    : (item.presentPlatforms || []).map(platformLabel).filter(Boolean).join(' + ');
  const score = item.match?.score?.total;
  const scoreParts = item.match?.score
    ? [
      `总分 ${scoreText(item.match.score.total)}`,
      `标题 ${scoreText(item.match.score.title)}`,
      `歌手 ${scoreText(item.match.score.artist)}`,
      `时长 ${scoreText(item.match.score.duration)}`,
    ].join(' / ')
    : '';
  const alternatives = item.alternatives?.length
    ? `<small>备选：${escapeHtml(item.alternatives.slice(0, 2).map((track) => [track.title, track.artist, track.duration].filter(Boolean).join(' / ')).join('；'))}</small>`
    : '';
  const targetPresence = item.targetPresence?.inLibrary
    ? `<small class="sync-presence-note">${escapeHtml(targetPresenceText(item.targetPresence))}</small>`
    : '';
  const matchWarning = match && item.error
    ? `<small class="sync-warning-note">${escapeHtml(displaySyncError(item.error))}</small>`
    : '';
  return `
    <article class="sync-item ${escapeAttr(item.status)}">
      <div class="sync-item-main">
        <div class="card-kicker">
          <span>${escapeHtml(item.clusterId)}</span>
          <span>${escapeHtml(sourceLabel ? `${sourceLabel} → ${targetLabel}` : targetLabel)}</span>
        </div>
        <h3>${escapeHtml(item.title || '(无标题)')}</h3>
        <p>${escapeHtml([item.artist, item.album, item.duration].filter(Boolean).join(' / '))}</p>
      </div>
      <div class="sync-item-result">
        <span class="sync-status ${escapeAttr(item.status)}">${escapeHtml(syncStatusLabel(item.status))}</span>
        ${match ? `
          <strong>${escapeHtml(match.title || '(无标题)')}</strong>
          <small>${escapeHtml([match.artist, match.album, match.duration].filter(Boolean).join(' / '))}</small>
          <small>${escapeHtml(scoreParts || `匹配分 ${scoreText(score)}`)}</small>
          ${matchWarning}
          ${targetPresence}
          ${alternatives}
        ` : `<small>${escapeHtml(displaySyncError(item.error || item.statusText || '暂无命中'))}</small>`}
        ${renderSyncAiSuggestion(item.aiSuggestion)}
        ${renderSyncDecisionActions(item)}
      </div>
    </article>
  `;
}

function syncFilterCounts(items = []) {
  return items.reduce((acc, item) => {
    if (isSyncWriteableItem(item)) acc.writeable += 1;
    if (isSyncReviewItem(item)) acc.review += 1;
    if (isSyncHandledItem(item)) acc.handled += 1;
    return acc;
  }, {
    writeable: 0,
    review: 0,
    handled: 0,
  });
}

function syncDashboardCounts(plan) {
  if (plan?.items?.length) {
    const counts = syncFilterCounts(plan.items);
    return {
      all: plan.items.length,
      ...counts,
    };
  }
  const summary = plan?.summary || {};
  const target = selectedSyncTarget();
  const targetQueue = currentState?.unified?.workflow?.syncableByPlatform?.[target]
    ?? currentState?.unified?.missingByPlatform?.[target]
    ?? currentState?.unified?.workflow?.syncableClusters
    ?? 0;
  return {
    all: plan?.exists ? plan.totalQueue || 0 : targetQueue,
    writeable: syncReadyCount(summary),
    review: syncReviewCount(summary),
    handled: syncHandledCount(summary),
  };
}

function updateSyncSummaryCards() {
  if (!elements.syncSummary) return;
  if (!['all', 'writeable', 'review', 'handled'].includes(activeSyncFilter)) activeSyncFilter = 'all';
  for (const button of elements.syncSummary.querySelectorAll('[data-sync-filter]')) {
    button.classList.toggle('active', button.dataset.syncFilter === activeSyncFilter);
  }
}

function filterSyncPlanItems(items = []) {
  if (!['all', 'writeable', 'review', 'handled'].includes(activeSyncFilter)) activeSyncFilter = 'all';
  if (activeSyncFilter === 'writeable') return items.filter(isSyncWriteableItem);
  if (activeSyncFilter === 'review') return items.filter(isSyncReviewItem);
  if (activeSyncFilter === 'handled') return items.filter(isSyncHandledItem);
  return items;
}

function isSyncWriteableItem(item) {
  return item.status === 'ready' || item.status === 'accepted';
}

function isSyncReviewItem(item) {
  return [
    'low_score',
    'needs_review',
    'pending_search',
    'searching',
    'rate_limited',
    'deferred',
    'error',
  ].includes(item.status);
}

function isSyncHandledItem(item) {
  return [
    'already_present',
    'rejected',
    'excluded_by_decision',
    'not_found',
  ].includes(item.status);
}

function isPendingSyncAiSuggestion(item, action) {
  if (item.aiSuggestion?.recommendedAction !== action) return false;
  if (item.decision?.action) return false;
  return !['accepted', 'rejected', 'already_present'].includes(item.status);
}

function renderSyncDecisionActions(item) {
  const match = item.match?.track;
  if (!item.decisionKey || !match?.id) return '';
  const current = item.decision?.action || '';
  if (item.status === 'already_present') {
    return `
      <div class="sync-choice-row">
        ${syncDecisionButton({
    label: '仍然跳过',
    item,
    action: 'reject',
    active: current === 'reject',
    tone: 'danger',
  })}
      </div>
    `;
  }
  const acceptLabel = item.targetPresence?.inLibrary
    ? '确认同一首（已存在）'
    : '确认写入';
  const rejectLabel = item.targetPresence?.inLibrary
    ? '不是这首'
    : '跳过';
  return `
    <div class="sync-choice-row">
      ${syncDecisionButton({
    label: acceptLabel,
    item,
    action: 'accept',
    active: current === 'accept',
    tone: 'include',
  })}
      ${syncDecisionButton({
    label: rejectLabel,
    item,
    action: 'reject',
    active: current === 'reject',
    tone: 'danger',
  })}
    </div>
  `;
}

function syncDecisionButton({ label, item, action, active, tone }) {
  return `
    <button
      class="choice-button ${tone || ''} ${active ? 'active' : ''}"
      type="button"
      data-sync-decision="true"
      data-key="${escapeAttr(item.decisionKey || '')}"
      data-action="${escapeAttr(action)}"
      data-target="${escapeAttr(item.target || 'netease')}"
      data-cluster-id="${escapeAttr(item.clusterId || '')}"
      data-track-id="${escapeAttr(item.match?.track?.id || '')}"
    >${escapeHtml(label)}</button>
  `;
}

function renderSyncAiSuggestion(suggestion) {
  if (!suggestion) return '';
  const action = syncAiActionLabel(suggestion.recommendedAction);
  const relation = relationLabel(suggestion.relation);
  const confidence = Math.round(Number(suggestion.confidence || 0) * 100);
  const evidence = [
    suggestion.evidence?.title ? `标题：${suggestion.evidence.title}` : '',
    suggestion.evidence?.artist ? `歌手：${suggestion.evidence.artist}` : '',
    suggestion.evidence?.duration ? `时长：${suggestion.evidence.duration}` : '',
    suggestion.evidence?.version ? `版本：${suggestion.evidence.version}` : '',
  ].filter(Boolean).join('；');
  const safety = suggestion.safety?.guarded ? syncAiSafetyText(suggestion.safety) : '';
  return `
    <div class="sync-candidate-ai">
      <div class="ai-suggestion-head">
        <strong>写入 AI：${escapeHtml(action)}</strong>
        <span>${confidence}%</span>
      </div>
      ${relation ? `<div class="ai-canonical">判断：${escapeHtml(relation)}</div>` : ''}
      ${suggestion.reason ? `<p>${escapeHtml(suggestion.reason)}</p>` : ''}
      ${evidence ? `<small>${escapeHtml(evidence)}</small>` : ''}
      ${safety ? `<small class="ai-safety">${escapeHtml(safety)}</small>` : ''}
    </div>
  `;
}

function syncAiSafetyText(safety) {
  const labels = {
    speculative_evidence: '本地安全闸：AI 使用了推测证据，已改为人工确认',
    version_cue_mismatch: '本地安全闸：版本词不一致，已改为人工确认',
    duration_delta: '本地安全闸：时长差过大，已改为人工确认',
    already_present: '本地安全闸：目标曲库已存在，已跳过写入',
    inconsistent_action: '本地安全闸：AI 结论自相矛盾，已改为人工确认',
  };
  return labels[safety?.code] || safety?.reason || '本地安全闸：已改为人工确认';
}

function renderSyncRunResult(result) {
  if (!result) return;
  if (elements.syncLastRun) {
    elements.syncLastRun.textContent = syncRunCountText(result);
  }
}

function syncRunCountText(run) {
  const add = run?.add || {};
  const requested = add.requested || 0;
  const added = add.added || 0;
  const already = add.alreadyPresent || add.alreadyPresentBefore || 0;
  if (run?.dryRun) return `dry-run ${requested}`;
  if (already) return `新增 ${added} / 已有 ${already}`;
  if (add.verified && requested && added !== requested) {
    return `已写入 ${added} / 请求 ${requested}`;
  }
  return `已写入 ${added || requested}`;
}

function syncStatusLabel(status) {
  const labels = {
    pending_search: '待搜索',
    searching: '搜索中',
    ready: '可写入',
    accepted: '已确认',
    already_present: '已存在',
    rejected: '已跳过',
    low_score: '低置信',
    not_found: '未命中',
    needs_review: '待决定',
    excluded_by_decision: '已分开/排除',
    rate_limited: '被限流',
    deferred: '待重试',
    error: '失败',
  };
  return labels[status] || status || '';
}

function syncPlanPaused(summary = {}) {
  return Boolean((summary.rate_limited || 0) + (summary.deferred || 0));
}

function syncPlanFinishText(summary = {}) {
  const existing = summary.already_present || 0;
  if (syncPlanPaused(summary)) {
    return `${selectedSyncTargetLabel()}触发频控，已暂停：可写入 ${syncReadyCount(summary)} 条，已存在 ${existing} 条，待重试 ${summary.deferred || 0} 条`;
  }
  return `计划完成：可写入 ${syncReadyCount(summary)} 条，已存在 ${existing} 条，需处理 ${syncProblemCount(summary)} 条`;
}

function targetPresenceText(presence = {}) {
  const track = presence.track || {};
  const name = [track.title, track.artist, track.duration].filter(Boolean).join(' / ');
  const source = presence.source ? `，来源 ${presence.source}` : '';
  return `候选目标已在目标库${name ? `：${name}` : ''}${source}；确认同一首后无需再写入。`;
}

function renderSyncAiApplySummary(result) {
  if (!elements.syncAiSummary || !result) return;
  const skipped = [
    result.skippedLowConfidence ? `低置信 ${result.skippedLowConfidence}` : '',
    result.skippedNeedsHuman ? `需人工 ${result.skippedNeedsHuman}` : '',
    result.skippedExisting ? `已有确认 ${result.skippedExisting}` : '',
  ].filter(Boolean).join(' / ');
  elements.syncAiSummary.textContent = `写入 AI 已采纳 ${result.applied || 0} 条：确认写入 ${result.accepted || 0} / 跳过 ${result.rejected || 0}${skipped ? `；跳过 ${skipped}` : ''}`;
}

function displaySyncError(value) {
  const text = String(value || '').trim();
  if (!text || text === '[object Object]') {
    return '网易云接口返回了未结构化错误；重跑后会记录详细响应';
  }
  return text;
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

function defaultSyncPlaylistName() {
  return `Likes Sync ${new Date().toISOString().slice(0, 10)}`;
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

function startSyncProgress(title, detail = '', options = {}) {
  if (!elements.syncProgress) return;
  clearTimeout(finishSyncProgress.timer);
  syncProgressStartedAt = Date.now();
  elements.syncProgress.hidden = false;
  elements.syncProgress.classList.add('running');
  elements.syncProgress.classList.remove('error');
  elements.syncProgressTitle.textContent = title;
  elements.syncProgressDetail.textContent = detail || '准备中';
  elements.syncProgressTime.textContent = '00:00';
  setSyncProgressAmount(options.done || 0, options.total || 0, options.determinate);
  clearInterval(syncProgressTimer);
  syncProgressTimer = setInterval(updateSyncProgressTime, 1000);
  clearInterval(syncProgressPollTimer);
  if (options.poll) {
    syncProgressPollTimer = setInterval(pollSyncProgress, 900);
    pollSyncProgress();
  }
}

function updateSyncProgress(detail, title = '', options = {}) {
  if (!elements.syncProgress || elements.syncProgress.hidden) return;
  if (title) elements.syncProgressTitle.textContent = title;
  if (detail) elements.syncProgressDetail.textContent = detail;
  if (
    options.determinate !== undefined
    || options.done !== undefined
    || options.total !== undefined
  ) {
    setSyncProgressAmount(options.done || 0, options.total || 0, options.determinate);
  }
  updateSyncProgressTime();
}

function finishSyncProgress(detail = '', options = {}) {
  if (!elements.syncProgress) return;
  clearInterval(syncProgressTimer);
  clearInterval(syncProgressPollTimer);
  syncProgressTimer = 0;
  syncProgressPollTimer = 0;
  updateSyncProgressTime();
  elements.syncProgress.classList.remove('running');
  elements.syncProgress.classList.toggle('error', Boolean(options.error));
  if (
    options.determinate !== undefined
    || options.done !== undefined
    || options.total !== undefined
  ) {
    setSyncProgressAmount(options.done || 0, options.total || 0, options.determinate);
  }
  if (detail) elements.syncProgressDetail.textContent = detail;
  const delay = options.error ? 5200 : 2600;
  clearTimeout(finishSyncProgress.timer);
  finishSyncProgress.timer = setTimeout(() => {
    elements.syncProgress.hidden = true;
    elements.syncProgress.classList.remove('error');
  }, delay);
}

function setSyncProgressAmount(done = 0, total = 0, determinate = false) {
  if (!elements.syncProgress) return;
  const numericDone = Number(done) || 0;
  const numericTotal = Number(total) || 0;
  const shouldDetermine = Boolean(determinate || numericTotal > 0);
  elements.syncProgress.classList.toggle('determinate', shouldDetermine);
  const bar = elements.syncProgress.querySelector('.sync-progress-bar');
  if (!shouldDetermine) {
    elements.syncProgress.style.removeProperty('--sync-progress');
    bar?.removeAttribute('role');
    bar?.removeAttribute('aria-valuemin');
    bar?.removeAttribute('aria-valuemax');
    bar?.removeAttribute('aria-valuenow');
    return;
  }
  const safeTotal = Math.max(1, numericTotal);
  const safeDone = Math.max(0, Math.min(safeTotal, numericDone));
  const percent = Math.max(0, Math.min(100, (safeDone / safeTotal) * 100));
  elements.syncProgress.style.setProperty('--sync-progress', `${percent.toFixed(1)}%`);
  bar?.setAttribute('role', 'progressbar');
  bar?.setAttribute('aria-valuemin', '0');
  bar?.setAttribute('aria-valuemax', String(safeTotal));
  bar?.setAttribute('aria-valuenow', String(safeDone));
}

function updateSyncProgressTime() {
  if (!elements.syncProgressTime || !syncProgressStartedAt) return;
  elements.syncProgressTime.textContent = formatElapsed(Date.now() - syncProgressStartedAt);
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

async function pollSyncProgress() {
  try {
    const payload = await getJson('/api/sync/progress');
    const progress = payload.progress || {};
    if (!progress.active && !progress.error) return;
    const current = progress.current?.title
      ? `；当前：${progress.current.title}${progress.current.artist ? ` - ${progress.current.artist}` : ''}`
      : '';
    const detail = progress.current?.detail ? `；${progress.current.detail}` : '';
    const count = progress.total
      ? `已处理 ${progress.done || 0} / ${progress.total}`
      : '正在准备';
    updateSyncProgress(progress.error || `${progress.phase || '处理中'}：${count}${current}${detail}`, progress.title || '', {
      done: progress.done || 0,
      total: progress.total || 0,
    });
  } catch {
    // The main request owns the user-visible error; polling is best-effort.
  }
}

function setBusy(nextBusy) {
  busy = nextBusy;
  for (const button of document.querySelectorAll('button')) {
    button.disabled = nextBusy;
  }
  if (!nextBusy) {
    refreshLibraryPagerState();
    refreshSyncPagerState();
    refreshMirrorPagerState();
    updateSyncTargetUi();
  }
}

function refreshLibraryPagerState() {
  const hasPrevious = libraryOffset > 0;
  const hasNext = libraryOffset + libraryLimit < libraryTotal;
  if (elements.libraryPrevButton) elements.libraryPrevButton.disabled = !hasPrevious;
  if (elements.libraryNextButton) elements.libraryNextButton.disabled = !hasNext;
}

function refreshSyncPagerState() {
  if (!currentSyncPlan?.items?.length) return;
  const filteredItems = filterSyncPlanItems(currentSyncPlan.items);
  const start = syncPageIndex * syncPageSize;
  if (elements.syncPrevButton) elements.syncPrevButton.disabled = start <= 0;
  if (elements.syncNextButton) elements.syncNextButton.disabled = start + syncPageSize >= filteredItems.length;
}

function refreshMirrorPagerState() {
  if (!currentMirrorPlan?.operations?.length) return;
  const page = currentMirrorPage(currentMirrorPlan);
  if (elements.mirrorPrevButton) elements.mirrorPrevButton.disabled = page.start <= 0;
  if (elements.mirrorNextButton) elements.mirrorNextButton.disabled = page.start + mirrorPageSize >= page.filteredOperations.length;
  renderMirrorBulkActions(currentMirrorPlan, page.pageItems);
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
