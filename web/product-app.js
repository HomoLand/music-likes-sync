const PRODUCT_LABELS = {
  apple: 'Apple Music',
  qq: 'QQ 音乐',
  netease: '网易云音乐',
};

const PRODUCT_STATE_LABELS = {
  readable: '已读取',
  writable: '可同步',
  not_connected: '未连接',
  needs_attention: '需处理',
};

const PRODUCT_BUCKETS = [
  ['all', '全部变化'],
  ['will_add', '将新增'],
  ['needs_confirmation', '需复核'],
  ['not_found', '未找到'],
  ['may_delete', '可能删除'],
  ['will_keep', '保持不动'],
];

const PRODUCT_AI_CAPABILITIES = [
  {
    title: 'AI 辅助判重',
    status: '下一步接入',
    body: '把 ISRC、时长、专辑、艺人别名和外部音乐数据库证据一起交给模型，只输出可审计判断。',
  },
  {
    title: '音乐喜好画像',
    status: '规划中',
    body: '根据多平台喜欢记录生成风格、年代、语种、情绪和艺人偏好，用于解释推荐来源。',
  },
  {
    title: '找相似歌曲',
    status: '规划中',
    body: '输入一首歌，返回相似编曲、相似人声、相似年代或同风格歌曲，并标明证据。',
  },
  {
    title: '自然语言音乐助理',
    status: 'Agent 工具层',
    body: '页面内对话可以调用本地曲库、平台搜索和证据复核工具，不直接暴露用户凭据。',
  },
];

const productState = {
  mode: 'canonical_mirror',
  targets: new Set(['qq', 'netease']),
  bucket: 'all',
  app: null,
  modes: [],
  preview: null,
  lastConvergence: null,
  lastResolution: null,
  tombstoneRisk: null,
  lastAiProviderTest: null,
  agentSessions: null,
  agentSessionsLoaded: false,
  baselineDetails: null,
  baselineDetailsLoaded: false,
  busy: false,
  tombstonePending: null,
  tombstoneFilter: 'undecided',
};

document.addEventListener('DOMContentLoaded', () => {
  mountProductApp();
});

function mountProductApp() {
  const workspace = document.querySelector('.workspace');
  if (!workspace || document.querySelector('#productApp')) return;

  const root = document.createElement('section');
  root.id = 'productApp';
  root.className = 'product-app';
  root.innerHTML = productTemplate();
  workspace.prepend(root);
  document.body.classList.add('product-ui-mounted');

  bindProductEvents(root);
  renderProductAi();
  renderProductAgentAudit();
  applyProductInitialRoute();
  window.addEventListener('hashchange', applyProductInitialRoute);
  loadProductBootstrap();
}

function productTemplate() {
  return `
    <div class="product-shell">
      <div class="product-top">
        <div class="product-title-block">
          <span class="product-kicker">普通用户模式</span>
          <h2>让三个音乐平台的喜欢歌曲保持一致</h2>
          <p>先连接平台，再选择同步方式。当前推荐以 Apple Music 为可信源，把新增和删除分别预览、分别执行；删除必须二次确认。</p>
          <div class="product-main-actions">
            <button class="product-button primary" type="button" id="productRunCheck">检查同步变化</button>
            <button class="product-button" type="button" id="productRefresh">刷新状态</button>
            <button class="product-button quiet" type="button" id="productAdvanced">打开高级工作台</button>
          </div>
        </div>
        <div class="product-status-panel">
          <div class="product-status-card">
            <span>当前模式</span>
            <strong id="productModeSummary">以 Apple Music 为准</strong>
            <p id="productNextAction">正在读取本机状态。</p>
          </div>
          <div class="product-status-card">
            <span>最新预览</span>
            <strong id="productPreviewSummary">暂无</strong>
            <p id="productPreviewHint">运行同步检查后显示新增、删除和需复核数量。</p>
          </div>
          <div class="product-status-card">
            <span>同步基线</span>
            <strong id="productBaselineSummary">未保存</strong>
            <p id="productBaselineHint">三端确认一致后保存，后续才能判断跨平台删除意图。</p>
          </div>
          <div class="product-status-card product-convergence-card" id="productConvergenceCard">
            <span>同步一致性</span>
            <strong id="productConvergenceSummary">待检查</strong>
            <p id="productConvergenceHint">执行后刷新平台快照并重新计算，确认是否还有差异。</p>
          </div>
        </div>
      </div>

      <nav class="product-nav" aria-label="普通用户流程">
        <button class="active" type="button" data-product-page="overview">概览</button>
        <button type="button" data-product-page="connect">连接平台</button>
        <button type="button" data-product-page="mode">同步方式</button>
        <button type="button" data-product-page="preview">预览执行</button>
        <button type="button" data-product-page="ai">AI 助理</button>
        <button type="button" data-product-page="advanced">高级设置</button>
      </nav>

      <div class="product-pages">
        <section class="product-page active" data-product-page-panel="overview">
          <div class="product-section-head">
            <div>
              <h3>同步概览</h3>
              <p>这里展示平台连接、曲目数量、最新预览和下一步动作。普通用户不需要处理 Cookie 或文件路径。</p>
            </div>
          </div>
          <div class="product-platform-grid" id="productOverviewPlatforms"></div>
          <div class="product-run-audit" id="productRunAudit"></div>
          <div class="product-baseline-diff" id="productBaselineDiff"></div>
        </section>

        <section class="product-page" data-product-page-panel="connect">
          <div class="product-section-head">
            <div>
              <h3>连接平台</h3>
              <p>优先使用扫码或浏览器授权。手动 Cookie 仍保留在高级工作台作为兜底。</p>
            </div>
          </div>
          <div class="product-platform-grid" id="productConnectPlatforms"></div>
        </section>

        <section class="product-page" data-product-page-panel="mode">
          <div class="product-section-head">
            <div>
              <h3>选择同步方式</h3>
              <p>默认方案适合你的个人需求：Apple Music 是唯一可信源，QQ 音乐和网易云跟随它新增或删除。</p>
            </div>
          </div>
          <div class="product-targets" aria-label="同步目标">
            <label class="product-target-toggle"><input type="checkbox" value="qq" checked>QQ 音乐</label>
            <label class="product-target-toggle"><input type="checkbox" value="netease" checked>网易云音乐</label>
          </div>
          <div class="product-mode-grid" id="productModes"></div>
        </section>

        <section class="product-page" data-product-page-panel="preview">
          <div class="product-section-head">
            <div>
              <h3>预览和执行</h3>
              <p>先同步新增，再单独处理删除。删除操作会写入确认记录，避免误删。</p>
            </div>
            <div class="product-action-row">
              <button class="product-button" type="button" id="productResolveAdditions">查找对应歌曲</button>
              <button class="product-button" type="button" id="productDryRunAdditions">模拟新增</button>
              <button class="product-button primary" type="button" id="productExecuteAdditions">执行新增</button>
              <button class="product-button danger" type="button" id="productOpenDelete">确认删除</button>
              <button class="product-button" type="button" id="productSaveBaseline">保存当前基线</button>
              <button class="product-button" type="button" id="productCheckConvergence">检查一致性</button>
            </div>
          </div>
          <div class="product-write-readiness" id="productWriteReadiness"></div>
          <div class="product-preview-layout">
            <div class="product-buckets" id="productBuckets"></div>
            <div class="product-preview-main">
              <div class="product-resolution-summary" id="productResolutionSummary" hidden></div>
              <div class="product-tombstone-risk" id="productTombstoneRisk" hidden></div>
              <div class="product-add-bulk" id="productAddBulk" hidden></div>
              <div class="product-tombstone-bulk" id="productTombstoneBulk"></div>
              <div class="product-preview-list" id="productPreviewList"></div>
            </div>
          </div>
        </section>

        <section class="product-page" data-product-page-panel="ai">
          <div class="product-section-head">
            <div>
              <h3>AI 助理</h3>
              <p>内置 AI 负责判重证据、喜好画像、推荐和找相似歌；Agent 工具层用于把这些能力开放给本地助理。</p>
            </div>
          </div>
          <div class="product-ai-workbench">
            <div class="product-action-row">
              <button class="product-button primary" type="button" id="productProfileButton">生成音乐画像</button>
              <button class="product-button" type="button" id="productProfileModelButton" disabled>AI 增强画像</button>
              <button class="product-button" type="button" id="productRecommendButton">生成本地推荐</button>
              <button class="product-button" type="button" id="productRecommendModelButton" disabled>AI 增强推荐</button>
            </div>
            <div class="product-ai-provider">
              <div class="product-ai-provider-head">
                <div>
                  <h4>AI 连接自检</h4>
                  <p id="productAiProviderCopy">正在读取本机 AI 配置。</p>
                </div>
                <span class="product-state-pill not_connected" id="productAiProviderPill">未检测</span>
              </div>
              <div class="product-ai-provider-meta" id="productAiProviderMeta"></div>
              <label class="product-ai-consent-row">
                <input id="productAiProviderConsent" type="checkbox">
                <span>我同意把最小测试提示或聚合后的画像证据发送给已配置的 AI Provider；不会发送 Cookie、原始歌单或平台凭据。</span>
              </label>
              <div class="product-action-row">
                <button class="product-button" type="button" id="productAiProviderTestButton" disabled>测试 AI 连接</button>
              </div>
              <div class="product-inline-note" id="productAiProviderResult">不会发送歌单、Cookie 或平台凭据；没有勾选同意时不会调用外部模型。</div>
            </div>
            <div class="product-seed-row">
              <input id="productSimilarTitle" autocomplete="off" placeholder="歌曲名">
              <input id="productSimilarArtist" autocomplete="off" placeholder="歌手">
              <button class="product-button" type="button" id="productSimilarButton">找相似歌曲</button>
            </div>
            <div class="product-inline-note" id="productAiResult">音乐画像、推荐和找相似歌曲只读取本地清洗后的曲目信息，不会写入任何平台。</div>
          </div>
          <div class="product-agent-audit">
            <div class="product-agent-audit-head">
              <div>
                <h4>Agent 工具审计</h4>
                <p id="productAgentAuditSummary">只显示本机只读工具调用摘要，不展示提示词、Cookie、API key 或平台原始返回。</p>
              </div>
              <button class="product-button" type="button" id="productAgentAuditRefresh">刷新审计</button>
            </div>
            <div class="product-agent-audit-list" id="productAgentAuditList"></div>
          </div>
          <div class="product-ai-grid" id="productAiGrid"></div>
        </section>

        <section class="product-page" data-product-page-panel="advanced">
          <div class="product-section-head">
            <div>
              <h3>高级设置</h3>
              <p>这里保留旧工作台、原始诊断和调试型操作。普通同步路径不需要打开这里。</p>
            </div>
          </div>
          <div class="product-advanced-grid">
            <article class="product-advanced-card">
              <div class="product-card-head">
                <h4>高级工作台</h4>
                <span class="product-state-pill needs_attention">谨慎操作</span>
              </div>
              <p>镜像计划、原始 Cookie 入口、批量 AI 复核、报告和低层写入诊断仍在兼容工作台里。</p>
              <button class="product-button" type="button" id="productShowAdvancedWorkbench">显示高级工作台</button>
            </article>
            <article class="product-advanced-card">
              <div class="product-card-head">
                <h4>发布验证</h4>
                <span class="product-state-pill readable" id="productAdvancedLivePill">读取中</span>
              </div>
              <p id="productAdvancedLiveCopy">正在读取 QQ / 网易云真实写入验证状态。</p>
            </article>
            <article class="product-advanced-card">
              <div class="product-card-head">
                <h4>AI Provider</h4>
                <span class="product-state-pill" id="productAdvancedAiPill">读取中</span>
              </div>
              <p id="productAdvancedAiCopy">模型、API key 和 provider 诊断保留在本机，不会出现在公开报告中。</p>
            </article>
          </div>
        </section>
      </div>
    </div>
    <div class="product-feedback" id="productFeedback" role="status" aria-live="polite"></div>
    <dialog class="product-delete-dialog" id="productDeleteDialog">
      <div class="product-dialog-card">
        <h3>确认删除</h3>
        <p id="productDeleteCopy">删除会让目标平台跟随 Apple Music。请输入确认文本后继续。</p>
        <input id="productDeleteInput" autocomplete="off" spellcheck="false">
        <div class="product-action-row">
          <button class="product-button quiet" type="button" id="productDeleteCancel">取消</button>
          <button class="product-button danger" type="button" id="productDeleteConfirm" disabled>写入确认</button>
          <button class="product-button danger" type="button" id="productDeleteExecute" disabled>执行删除</button>
        </div>
      </div>
    </dialog>
    <dialog class="product-delete-dialog" id="productTombstoneDialog">
      <div class="product-dialog-card">
        <h3>确认全局删除意图</h3>
        <p id="productTombstoneCopy">全局删除会把这首歌从其他可写平台移除。请输入确认文本后继续。</p>
        <input id="productTombstoneInput" autocomplete="off" spellcheck="false">
        <div class="product-action-row">
          <button class="product-button quiet" type="button" id="productTombstoneCancel">取消</button>
          <button class="product-button danger" type="button" id="productTombstoneConfirm" disabled>确认全局删除</button>
        </div>
      </div>
    </dialog>
  `;
}

function bindProductEvents(root) {
  root.querySelectorAll('[data-product-page]').forEach((button) => {
    button.addEventListener('click', () => activateProductPage(button.dataset.productPage));
  });

  root.querySelector('#productRefresh')?.addEventListener('click', loadProductBootstrap);
  root.querySelector('#productBaselineDiff')?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-product-baseline-refresh]');
    if (button) loadProductBaselineDetails();
  });
  root.querySelector('#productRunCheck')?.addEventListener('click', runProductCheck);
  root.querySelector('#productAdvanced')?.addEventListener('click', () => {
    activateProductPage('advanced');
    document.querySelector('#productApp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelector('#productShowAdvancedWorkbench')?.addEventListener('click', () => {
    activateProductPage('advanced');
    document.querySelector('.workspace > .grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelector('#productResolveAdditions')?.addEventListener('click', resolveProductAdditions);
  root.querySelector('#productDryRunAdditions')?.addEventListener('click', () => executeProductAdditions(true));
  root.querySelector('#productExecuteAdditions')?.addEventListener('click', () => executeProductAdditions(false));
  root.querySelector('#productOpenDelete')?.addEventListener('click', openProductDeleteDialog);
  root.querySelector('#productSaveBaseline')?.addEventListener('click', saveProductBaseline);
  root.querySelector('#productCheckConvergence')?.addEventListener('click', checkProductConvergence);
  root.querySelector('#productProfileButton')?.addEventListener('click', generateProductProfile);
  root.querySelector('#productProfileModelButton')?.addEventListener('click', generateProductModelProfile);
  root.querySelector('#productRecommendButton')?.addEventListener('click', generateProductRecommendations);
  root.querySelector('#productRecommendModelButton')?.addEventListener('click', generateProductModelRecommendations);
  root.querySelector('#productSimilarButton')?.addEventListener('click', findProductSimilar);
  root.querySelector('#productAiProviderConsent')?.addEventListener('change', renderProductAiProviderStatus);
  root.querySelector('#productAiProviderTestButton')?.addEventListener('click', testProductAiProviderConnection);
  root.querySelector('#productAgentAuditRefresh')?.addEventListener('click', () => loadProductAgentSessions());
  root.querySelector('#productDeleteCancel')?.addEventListener('click', closeProductDeleteDialog);
  root.querySelector('#productDeleteInput')?.addEventListener('input', refreshProductDeleteState);
  root.querySelector('#productDeleteConfirm')?.addEventListener('click', confirmProductDeletions);
  root.querySelector('#productDeleteExecute')?.addEventListener('click', executeProductDeletions);
  root.querySelector('#productTombstoneCancel')?.addEventListener('click', closeProductTombstoneDialog);
  root.querySelector('#productTombstoneInput')?.addEventListener('input', refreshProductTombstoneState);
  root.querySelector('#productTombstoneConfirm')?.addEventListener('click', confirmGlobalProductTombstone);
  root.querySelectorAll('.product-target-toggle input').forEach((input) => {
    input.addEventListener('change', () => {
      productState.targets = new Set([...root.querySelectorAll('.product-target-toggle input:checked')].map((item) => item.value));
      if (!productState.targets.size) {
        input.checked = true;
        productState.targets.add(input.value);
      }
      renderProductWriteReadiness();
      renderProductExecutionControls();
      loadProductBaselineDetails({ silent: true });
    });
  });
}

async function loadProductBootstrap() {
  await withProductBusy('正在读取本机状态', async () => {
    const [app, modes] = await Promise.all([
      productGet('/api/app/state'),
      productGet('/api/sync/modes'),
    ]);
    productState.app = app;
    productState.mode = app.syncMode?.id || productState.mode;
    productState.modes = modes.modes || [];
    productState.lastConvergence = app.latestPreview?.convergence?.exists ? app.latestPreview.convergence : productState.lastConvergence;
    renderProductState();
    renderProductModes();
    renderProductBuckets();
    renderProductExecutionControls();
    if (app.latestPreview?.exists) await loadProductPreview(productState.bucket);
  });
  await loadProductBaselineDetails({ silent: true });
  await loadProductAgentSessions({ silent: true });
}

async function loadProductBaselineDetails(options = {}) {
  try {
    const platforms = ['apple', ...selectedProductTargets()].join(',');
    const result = await productGet(`/api/sync/baseline?platforms=${encodeURIComponent(platforms)}`);
    productState.baselineDetails = result;
    productState.baselineDetailsLoaded = true;
    renderProductBaselineDiff();
    if (!options.silent) setProductFeedback('已刷新同步基线变化。');
    return result;
  } catch (error) {
    productState.baselineDetails = { error: error.message || '同步基线变化暂时不可用。' };
    productState.baselineDetailsLoaded = true;
    renderProductBaselineDiff();
    if (!options.silent) setProductFeedback(productState.baselineDetails.error, true);
    return null;
  }
}

async function runProductCheck() {
  await withProductBusy('正在生成同步预览', async () => {
    const targets = [...productState.targets];
    const result = await productPost('/api/sync/check', {
      mode: productState.mode,
      source: 'apple',
      target: targets[0] || 'qq',
      targets,
      platforms: ['apple', ...targets],
      deletionPolicy: 'ask',
      threshold: 0.82,
      reviewThreshold: 0.68,
    });
    productState.preview = {
      previewId: result.previewId,
      generatedAt: result.generatedAt,
      mode: result.mode || productState.mode,
      counts: result.counts || {},
      convergence: result.convergence,
      total: Object.values(result.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
      items: [],
    };
    productState.lastResolution = null;
    productState.lastConvergence = result.convergence?.exists ? result.convergence : null;
    renderProductPreviewSummary();
    renderProductBuckets();
    renderProductExecutionControls();
    renderProductResolutionSummary();
    await loadProductPreview(productState.bucket);
    activateProductPage('preview');
  });
}

async function loadProductPreview(bucket) {
  productState.bucket = bucket;
  if (bucket === 'may_delete' && !productState.tombstoneFilter) {
    productState.tombstoneFilter = 'undecided';
  }
  try {
    const preview = await productGet(`/api/sync/preview?bucket=${encodeURIComponent(bucket)}&limit=30`);
    productState.preview = preview;
    if (bucket === 'may_delete') {
      await loadProductTombstoneRisk();
    } else {
      productState.tombstoneRisk = null;
    }
    renderProductPreviewSummary();
    renderProductBuckets();
    renderProductExecutionControls();
    productState.lastResolution = preview.addResolution || productState.lastResolution;
    renderProductResolutionSummary();
    renderProductPreviewList();
  } catch (error) {
    renderProductPreviewEmpty(error.message || '还没有同步预览。');
  }
}

async function loadProductTombstoneRisk() {
  try {
    productState.tombstoneRisk = await productPost('/api/ai/tombstones/analyze', {
      limit: 30,
      useModel: false,
    });
  } catch (error) {
    productState.tombstoneRisk = {
      error: error.message || '删除风险分析暂时不可用。',
    };
  }
}

async function resolveProductAdditions() {
  await withProductBusy('正在查找目标平台对应歌曲', async () => {
    const result = await productPost('/api/sync/resolve-additions', {
      targets: selectedProductTargets(),
      bucket: productState.bucket,
      resolveLimit: 50,
      searchLimit: 12,
      threshold: 0.82,
      reviewThreshold: 0.68,
      previewLimit: 30,
    });
    productState.lastResolution = result.addResolution || null;
    productState.preview = {
      previewId: result.previewId,
      generatedAt: result.generatedAt,
      mode: result.mode || productState.mode,
      counts: result.counts || {},
      addResolution: result.addResolution || null,
      bucket: result.preview?.bucket || productState.bucket,
      total: result.preview?.total || 0,
      items: result.preview?.items || [],
    };
    renderProductPreviewSummary();
    renderProductBuckets();
    renderProductExecutionControls();
    renderProductResolutionSummary();
    renderProductPreviewList();
    setProductFeedback(productResolutionFeedback(result.addResolution));
    return result;
  });
}

async function executeProductAdditions(dryRun) {
  await withProductBusy(dryRun ? '正在模拟新增' : '正在执行新增', async () => {
    const result = await productPost('/api/sync/execute-additions', {
      targets: selectedProductTargets(),
      dryRun,
      force: false,
    });
    productState.lastConvergence = result.convergence || null;
    setProductFeedback(dryRun ? '模拟新增完成。' : '新增执行完成。');
    productState.app = await productGet('/api/app/state');
    renderProductState();
    await loadProductPreview(productState.bucket);
    return result;
  });
}

function openProductDeleteDialog() {
  if (productUsesTombstoneDeletion()) {
    executeProductDeletions();
    return;
  }
  if (!productAllowsDeleteExecution()) {
    setProductFeedback('当前同步方式不会执行删除。', true);
    return;
  }
  const targets = selectedProductTargets();
  const expected = productDeleteExpected(targets);
  const targetLabel = targets.map((target) => PRODUCT_LABELS[target] || target).join('、');
  const dialog = document.querySelector('#productDeleteDialog');
  const input = document.querySelector('#productDeleteInput');
  const copy = document.querySelector('#productDeleteCopy');
  if (copy) copy.textContent = `将确认 ${targetLabel} 上的删除候选。请输入 ${expected} 后继续。`;
  if (input) input.value = '';
  refreshProductDeleteState();
  if (dialog?.showModal) dialog.showModal();
}

function closeProductDeleteDialog() {
  document.querySelector('#productDeleteDialog')?.close();
}

function refreshProductDeleteState() {
  const expected = productDeleteExpected(selectedProductTargets());
  const value = document.querySelector('#productDeleteInput')?.value.trim().toUpperCase() || '';
  const ready = value === expected && !productState.busy;
  const writeReadiness = productWriteReadiness();
  document.querySelector('#productDeleteConfirm')?.toggleAttribute('disabled', !ready);
  const executeButton = document.querySelector('#productDeleteExecute');
  executeButton?.toggleAttribute('disabled', !(ready && writeReadiness.ok));
  if (executeButton) {
    executeButton.title = writeReadiness.ok
      ? '目标平台验证已通过，可以执行真实删除。'
      : writeReadiness.message;
  }
}

async function confirmProductDeletions() {
  const targets = selectedProductTargets();
  const confirmText = document.querySelector('#productDeleteInput')?.value || '';
  await withProductBusy('正在写入删除确认', async () => {
    const result = await productPost('/api/sync/confirm-deletions', { targets, confirmText });
    setProductFeedback(`已确认 ${result.confirmed || 0} 个删除候选。`);
    productState.app = await productGet('/api/app/state');
    renderProductState();
    closeProductDeleteDialog();
  });
}

async function executeProductDeletions() {
  const targets = selectedProductTargets();
  await withProductBusy('正在执行删除', async () => {
    const result = await productPost('/api/sync/execute-deletions', {
      targets,
      dryRun: false,
      force: false,
    });
    productState.lastConvergence = result.convergence || null;
    setProductFeedback(`删除执行完成，请刷新平台快照确认。请求删除 ${result.remove?.requested || 0} 条。`);
    productState.app = await productGet('/api/app/state');
    renderProductState();
    await loadProductPreview(productState.bucket);
    closeProductDeleteDialog();
  });
}

async function checkProductConvergence() {
  await withProductBusy('正在检查同步一致性', async () => {
    const result = await productPost('/api/sync/convergence', {
      targets: selectedProductTargets(),
      refreshTarget: true,
    });
    productState.lastConvergence = result.convergence || null;
    productState.app = await productGet('/api/app/state');
    if (result.preview) productState.preview = { ...productState.preview, ...result.preview };
    renderProductState();
    renderProductPreviewSummary();
    renderProductExecutionControls();
    setProductFeedback(convergenceFeedbackText(result.convergence));
    return result;
  });
}

async function saveProductBaseline() {
  const convergence = currentProductConvergence();
  if (!convergence?.converged || convergence.status !== 'converged') {
    setProductFeedback('先完成一致性检查并处理所有差异，再保存同步基线。', true);
    return;
  }
  const activateManaged = productState.mode === 'canonical_mirror' || productState.mode === 'managed_bidirectional';
  await withProductBusy('正在保存同步基线', async () => {
    const result = await productPost('/api/sync/baseline/save', {
      platforms: ['apple', ...selectedProductTargets()],
      targets: selectedProductTargets(),
      policy: productState.mode,
      source: 'product-ui',
      requireConverged: true,
      previewId: convergence.previewId || productState.preview?.previewId || '',
      activateManaged,
    });
    const count = result.baseline?.summary?.tracks || 0;
    productState.baselineDetails = result;
    productState.baselineDetailsLoaded = true;
    if (result.activatedPolicy?.id) {
      productState.mode = result.activatedPolicy.id;
      if (result.preview) {
        productState.preview = {
          ...result.preview,
          total: Object.values(result.preview.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
          items: [],
        };
      }
      productState.lastConvergence = result.preview?.convergence || productState.lastConvergence;
      setProductFeedback(`已保存当前同步基线：${count} 首。后续将按“${result.activatedPolicy.label || '自动同步新增，删除需确认'}”运行。`);
    } else {
      setProductFeedback(`已保存当前同步基线：${count} 首。`);
    }
    productState.app = await productGet('/api/app/state');
    if (result.activatedPolicy?.id) {
      productState.app = {
        ...(productState.app || {}),
        syncMode: result.activatedPolicy,
      };
    }
    productState.lastConvergence = result.preview?.convergence || (result.convergence?.exists ? result.convergence : productState.lastConvergence);
    renderProductState();
    renderProductModes();
    renderProductPreviewList();
    renderProductBaselineDiff();
  });
}

async function applyProductTombstoneDecision(input) {
  await withProductBusy('正在保存删除意图处理', async () => {
    const result = await productPost('/api/sync/tombstones', input);
    setProductFeedback(`已保存删除意图处理：${tombstoneActionText(input.action)}。`);
    productState.app = await productGet('/api/app/state');
    await loadProductBaselineDetails({ silent: true });
    renderProductState();
    await loadProductPreview(productState.bucket);
    return result;
  });
}

async function applyProductTombstoneBatch(action) {
  const items = filteredProductTombstoneItems(productState.preview?.items || [])
    .filter((item) => item.tombstoneKey)
    .map((item) => ({
      tombstoneKey: item.tombstoneKey,
      operationId: item.id,
      platform: item.sourcePlatform || item.sourcePlatforms?.[0] || '',
    }));
  if (!items.length) return;
  await withProductBusy('正在批量保存删除意图处理', async () => {
    const result = await productPost('/api/sync/tombstones', {
      action,
      items,
    });
    setProductFeedback(`已批量保存 ${result.changed || items.length} 个删除意图：${tombstoneActionText(action)}。`);
    productState.app = await productGet('/api/app/state');
    renderProductState();
    await loadProductPreview(productState.bucket);
    return result;
  });
}

function openProductTombstoneDialog(input) {
  productState.tombstonePending = input;
  const expected = productTombstoneExpected(input.sourcePlatform);
  const dialog = document.querySelector('#productTombstoneDialog');
  const inputNode = document.querySelector('#productTombstoneInput');
  const copy = document.querySelector('#productTombstoneCopy');
  if (copy) {
    copy.textContent = `将确认这首歌需要从所有可写平台删除。请输入 ${expected} 后继续。`;
  }
  if (inputNode) inputNode.value = '';
  refreshProductTombstoneState();
  if (dialog?.showModal) dialog.showModal();
}

function closeProductTombstoneDialog() {
  productState.tombstonePending = null;
  document.querySelector('#productTombstoneDialog')?.close();
}

function refreshProductTombstoneState() {
  const pending = productState.tombstonePending;
  const expected = pending ? productTombstoneExpected(pending.sourcePlatform) : '';
  const value = document.querySelector('#productTombstoneInput')?.value.trim().toUpperCase() || '';
  const ready = Boolean(pending) && value === expected && !productState.busy;
  document.querySelector('#productTombstoneConfirm')?.toggleAttribute('disabled', !ready);
}

async function confirmGlobalProductTombstone() {
  const pending = productState.tombstonePending;
  if (!pending) return;
  const confirmText = document.querySelector('#productTombstoneInput')?.value || '';
  await applyProductTombstoneDecision({
    tombstoneKey: pending.tombstoneKey,
    operationId: pending.operationId,
    action: 'confirm_global_delete',
    platform: pending.sourcePlatform,
    confirmText,
  });
  closeProductTombstoneDialog();
}

async function generateProductProfile() {
  await withProductBusy('正在生成音乐画像', async () => {
    const profile = await productPost('/api/ai/profile', { refresh: true });
    renderProductProfileResult(profile);
  });
}

async function generateProductModelProfile() {
  const consent = Boolean(document.querySelector('#productAiProviderConsent')?.checked);
  if (!consent) {
    setProductFeedback('需要先勾选同意，才会把聚合后的画像证据发送给 AI Provider。', true);
    return;
  }
  await withProductBusy('正在生成 AI 增强画像', async () => {
    const profile = await productPost('/api/ai/profile', {
      refresh: true,
      useModel: true,
      consent: true,
    });
    renderProductProfileResult(profile);
  });
}

function renderProductProfileResult(profile = {}) {
  renderProductAiResult([
    `画像曲库：${profile.summary?.trackCount || 0} 首`,
    `常听艺人：${(profile.summary?.topArtists || []).slice(0, 4).map((item) => item.name).join('、') || '暂无'}`,
    `主要语言：${(profile.summary?.languages || []).slice(0, 3).map((item) => item.name).join('、') || '暂无'}`,
    profile.aiSummary?.summary ? `画像总结：${profile.aiSummary.summary}` : '',
    profile.aiSummary?.tasteTags?.length ? `画像标签：${profile.aiSummary.tasteTags.slice(0, 6).join('、')}` : '',
    profile.model?.used ? `模型增强：${providerDisplayName(profile.model.provider?.provider)} / ${profile.model.model || '默认模型'}` : '模型增强：未使用，本地画像',
  ].filter(Boolean));
}

async function generateProductRecommendations() {
  await withProductBusy('正在生成本地推荐', async () => {
    const recommendations = await productPost('/api/ai/recommend', {
      limit: 8,
      saveShortlist: true,
      shortlistName: 'Product assistant picks',
    });
    renderProductRecommendationsResult(recommendations);
  });
}

async function generateProductModelRecommendations() {
  const consent = Boolean(document.querySelector('#productAiProviderConsent')?.checked);
  if (!consent) {
    setProductFeedback('需要先勾选同意，才会把聚合后的推荐候选证据发送给 AI Provider。', true);
    return;
  }
  await withProductBusy('正在生成 AI 增强推荐', async () => {
    const recommendations = await productPost('/api/ai/recommend', {
      limit: 8,
      saveShortlist: true,
      shortlistName: 'Product assistant picks',
      useModel: true,
      consent: true,
    });
    renderProductRecommendationsResult(recommendations);
  });
}

function renderProductRecommendationsResult(recommendations = {}) {
  renderProductAiResult([
    `推荐候选：${recommendations.total || 0} 首`,
    recommendations.aiSummary?.summary ? `推荐总结：${recommendations.aiSummary.summary}` : '',
    ...((recommendations.candidates || []).slice(0, 5).map((item) => {
      const base = `${item.track?.title || 'Untitled'} - ${item.track?.artist || ''}`;
      return item.aiReason ? `${base}：${item.aiReason}` : base;
    })),
    recommendations.savedShortlist ? `已保存本地 shortlist：${recommendations.savedShortlist.trackCount || 0} 首` : '',
    recommendations.model?.used ? `模型增强：${providerDisplayName(recommendations.model.provider?.provider)} / ${recommendations.model.model || '默认模型'}` : '模型增强：未使用，本地推荐',
  ].filter(Boolean));
}

async function findProductSimilar() {
  const title = document.querySelector('#productSimilarTitle')?.value.trim() || '';
  const artist = document.querySelector('#productSimilarArtist')?.value.trim() || '';
  await withProductBusy('正在查找相似歌曲', async () => {
    const result = await productPost('/api/ai/similar', {
      seed: { title, artist },
      limit: 8,
    });
    renderProductAiResult(result.seed
      ? [
        `相似候选：${result.total || 0} 首`,
        ...((result.candidates || []).slice(0, 6).map((item) => `${item.track?.title || 'Untitled'} - ${item.track?.artist || ''}（${item.score || 0}）`)),
      ]
      : ['需要先输入歌曲名或歌手。']);
  });
}

async function testProductAiProviderConnection() {
  const consent = Boolean(document.querySelector('#productAiProviderConsent')?.checked);
  if (!consent) {
    setProductFeedback('需要先勾选同意，才会向 AI Provider 发送最小测试提示。', true);
    return;
  }
  await withProductBusy('正在测试 AI 连接', async () => {
    const result = await productPost('/api/ai/provider/test', { consent: true });
    productState.lastAiProviderTest = result;
    renderProductAiProviderStatus();
    renderProductAiResult([
      `AI 连接通过：${providerDisplayName(result.provider)} / ${result.model || '默认模型'}`,
      `JSON 能力：${result.response?.capability || '已验证'}`,
      `Token 用量：${formatAiUsage(result.usage)}`,
    ]);
  });
}

function renderProductState() {
  renderProductPlatforms('#productOverviewPlatforms');
  renderProductPlatforms('#productConnectPlatforms', true);
  const modeSummary = document.querySelector('#productModeSummary');
  const nextAction = document.querySelector('#productNextAction');
  if (modeSummary) modeSummary.textContent = productState.app?.syncMode?.label || '以 Apple Music 为准';
  if (nextAction) nextAction.textContent = nextActionText(productState.app?.nextAction);
  renderProductPreviewSummary();
  renderProductBaselineSummary();
  renderProductRunAudit();
  renderProductBaselineDiff();
  renderProductConvergenceSummary();
  renderProductResolutionSummary();
  renderProductWriteReadiness();
  renderProductExecutionControls();
  renderProductAiProviderStatus();
  renderProductAdvancedStatus();
}

function renderProductPlatforms(selector, actions = false) {
  const node = document.querySelector(selector);
  if (!node) return;
  const platforms = productState.app?.platforms || [];
  node.innerHTML = platforms.map((platform) => `
    <article class="product-platform-card">
      <div class="product-card-head">
        <h4>${escapeProductHtml(platform.label || PRODUCT_LABELS[platform.id] || platform.id)}</h4>
        <span class="product-state-pill ${escapeProductAttr(platform.state)}">${escapeProductHtml(PRODUCT_STATE_LABELS[platform.state] || platform.state)}</span>
      </div>
      <p>${platformCopy(platform)}</p>
      <div class="product-platform-meta">
        <span>${Number(platform.trackCount || 0)} 首</span>
        <span>${platform.lastReadAt ? `读取于 ${formatProductTime(platform.lastReadAt)}` : '尚未读取'}</span>
      </div>
      ${platformLiveValidation(platform.id)}
      ${actions ? platformAction(platform) : ''}
    </article>
  `).join('');
  node.querySelectorAll('[data-product-proxy]').forEach((button) => {
    button.addEventListener('click', () => proxyClick(button.dataset.productProxy));
  });
}

function renderProductModes() {
  const node = document.querySelector('#productModes');
  if (!node) return;
  node.innerHTML = productState.modes.map((mode) => `
    <button class="product-mode-card ${mode.id === productState.mode ? 'active' : ''}" type="button" data-product-mode="${escapeProductAttr(mode.id)}">
      <div class="product-card-head">
        <h4>${escapeProductHtml(mode.label)}</h4>
        <span class="product-risk-pill ${escapeProductAttr(mode.risk)}">${mode.recommended ? '推荐' : riskText(mode.risk)}</span>
      </div>
      <p>${escapeProductHtml(mode.description || '')}</p>
      <div class="product-platform-meta">
        <span>${mode.writes ? '会写入平台' : '只读分析'}</span>
        <span>${mode.deletionRequiresConfirmation ? '删除需确认' : '不会删除'}</span>
      </div>
    </button>
  `).join('');
  node.querySelectorAll('[data-product-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      productState.mode = button.dataset.productMode;
      renderProductModes();
      renderProductState();
      renderProductExecutionControls();
    });
  });
}

function renderProductExecutionControls() {
  const resolveButton = document.querySelector('#productResolveAdditions');
  const dryRunButton = document.querySelector('#productDryRunAdditions');
  const executeButton = document.querySelector('#productExecuteAdditions');
  const deleteButton = document.querySelector('#productOpenDelete');
  const baselineButton = document.querySelector('#productSaveBaseline');
  const counts = productState.preview?.counts || productState.app?.latestPreview?.counts || {};
  const hasAdditions = Number(counts.will_add || 0) > 0;
  const writeReadiness = productWriteReadiness();
  if (resolveButton) {
    resolveButton.disabled = productState.busy || !hasAdditions;
    resolveButton.title = hasAdditions
      ? '先在目标平台查找对应歌曲，不会写入平台。'
      : '当前预览没有需要新增的歌曲。';
  }
  if (dryRunButton) {
    dryRunButton.disabled = productState.busy || !hasAdditions;
    dryRunButton.title = hasAdditions ? '模拟新增不会写入平台，也不需要 live validation。' : '当前预览没有需要新增的歌曲。';
  }
  if (executeButton) {
    executeButton.disabled = productState.busy || !hasAdditions || !writeReadiness.ok;
    executeButton.title = !hasAdditions
      ? '当前预览没有需要新增的歌曲。'
      : writeReadiness.ok
      ? '目标平台验证已通过，可以执行真实新增。'
      : writeReadiness.message;
  }
  if (baselineButton) {
    const convergence = currentProductConvergence();
    const canSave = Boolean(convergence?.converged && convergence.status === 'converged');
    baselineButton.disabled = productState.busy || !canSave;
    baselineButton.title = canSave
      ? '保存已收敛的三端状态，作为后续自动同步的判断基线。'
      : '先完成一致性检查，并确认没有待新增、待复核或可能删除的项目。';
  }
  if (!deleteButton) return;
  const mode = productCurrentMode();
  if (mode === 'managed_bidirectional') {
    deleteButton.textContent = '执行已确认删除';
    deleteButton.title = writeReadiness.ok
      ? '先在可能删除中确认全局删除，然后执行已确认的删除。'
      : writeReadiness.message;
    deleteButton.disabled = productState.busy || !writeReadiness.ok;
    return;
  }
  if (mode === 'canonical_mirror') {
    deleteButton.textContent = '确认删除';
    deleteButton.title = 'Apple Music 可信源模式需要先写入删除确认。';
    deleteButton.disabled = productState.busy;
    return;
  }
  deleteButton.textContent = '不执行删除';
  deleteButton.title = '当前同步方式不会执行删除。';
  deleteButton.disabled = true;
}

function renderProductBuckets() {
  const node = document.querySelector('#productBuckets');
  if (!node) return;
  const counts = productState.preview?.counts || productState.app?.latestPreview?.counts || {};
  node.innerHTML = PRODUCT_BUCKETS.map(([bucket, label]) => {
    const value = bucket === 'all'
      ? Object.values(counts).reduce((sum, item) => sum + Number(item || 0), 0)
      : Number(counts[bucket] || 0);
    return `
      <button class="product-bucket-button ${bucket === productState.bucket ? 'active' : ''}" type="button" data-product-bucket="${bucket}">
        <span>${label}</span>
        <strong>${value}</strong>
      </button>
    `;
  }).join('');
  node.querySelectorAll('[data-product-bucket]').forEach((button) => {
    button.addEventListener('click', () => loadProductPreview(button.dataset.productBucket));
  });
}

function renderProductPreviewSummary() {
  const summary = document.querySelector('#productPreviewSummary');
  const hint = document.querySelector('#productPreviewHint');
  const latest = productState.preview || productState.app?.latestPreview;
  if (!latest?.counts) {
    if (summary) summary.textContent = '暂无';
    if (hint) hint.textContent = '运行同步检查后显示新增、删除和需复核数量。';
    return;
  }
  const counts = latest.counts || {};
  if (summary) {
    summary.textContent = `${Number(counts.will_add || 0)} 新增 / ${Number(counts.may_delete || 0)} 删除 / ${Number(counts.needs_confirmation || 0)} 复核 / ${Number(counts.not_found || 0)} 未找到`;
  }
  if (hint) hint.textContent = latest.generatedAt ? `生成于 ${formatProductTime(latest.generatedAt)}` : '已生成同步预览。';
}

function renderProductBaselineSummary() {
  const summary = document.querySelector('#productBaselineSummary');
  const hint = document.querySelector('#productBaselineHint');
  const baseline = productState.app?.baseline || {};
  if (!baseline.exists) {
    if (summary) summary.textContent = '未保存';
    if (hint) hint.textContent = '三端确认一致后保存，后续才能判断跨平台删除意图。';
    return;
  }
  const tracks = Number(baseline.summary?.tracks || 0);
  const platforms = Number(baseline.summary?.platforms || Object.keys(baseline.platforms || {}).length);
  if (summary) summary.textContent = `${platforms} 个平台 / ${tracks} 首`;
  if (hint) hint.textContent = baseline.savedAt ? `保存于 ${formatProductTime(baseline.savedAt)}` : '已保存同步基线。';
}

function renderProductBaselineDiff() {
  const node = document.querySelector('#productBaselineDiff');
  if (!node) return;
  const details = productState.baselineDetails || {};
  if (details.error) {
    node.innerHTML = `
      <div class="product-baseline-diff-head">
        <div>
          <h4>同步基线变化</h4>
          <p>${escapeProductHtml(details.error)}</p>
        </div>
        <button class="product-button" type="button" data-product-baseline-refresh>重试</button>
      </div>
    `;
    return;
  }
  if (!productState.baselineDetailsLoaded) {
    node.innerHTML = '<div class="product-baseline-empty">正在读取同步基线变化。</div>';
    return;
  }
  const baseline = details.baseline || productState.app?.baseline || {};
  const diff = details.diff || {};
  const tombstones = details.tombstones || productState.app?.deletionConfirmations || {};
  if (!baseline.exists) {
    node.innerHTML = `
      <div class="product-baseline-diff-head">
        <div>
          <h4>同步基线变化</h4>
          <p>暂无同步基线。三端收敛后保存一次，后续才能判断“在哪个平台删除过”。</p>
        </div>
        <button class="product-button" type="button" data-product-baseline-refresh>刷新</button>
      </div>
    `;
    return;
  }

  const summary = diff.summary || {};
  const added = Number(summary.added || 0);
  const deleted = Number(summary.deleted || 0);
  const unchanged = Number(summary.unchanged || 0);
  const platformRows = Object.values(diff.platforms || {});
  const baselineExamples = (Array.isArray(diff.examples) && diff.examples.length
    ? diff.examples
    : platformRows.flatMap((item) => Array.isArray(item.examples) ? item.examples : [])
  ).slice(0, 8);
  node.innerHTML = `
    <div class="product-baseline-diff-head">
      <div>
        <h4>同步基线变化</h4>
        <p>${escapeProductHtml(baseline.savedAt ? `基线保存于 ${formatProductTime(baseline.savedAt)}。` : '已保存同步基线。')}新增信号和删除信号只说明相对基线发生变化，不会自动写入平台。</p>
      </div>
      <button class="product-button" type="button" data-product-baseline-refresh>刷新</button>
    </div>
    <div class="product-baseline-stats">
      <span><strong>${added}</strong> 新增信号</span>
      <span><strong>${deleted}</strong> 删除信号</span>
      <span><strong>${unchanged}</strong> 保持不变</span>
      <span><strong>${Number(tombstones.total || 0)}</strong> 已处理删除意图</span>
    </div>
    <div class="product-baseline-platforms">
      ${platformRows.map((item) => `
        <div>
          <span>${escapeProductHtml(PRODUCT_LABELS[item.platform] || item.platform)}</span>
          <strong>+${Number(item.added || 0)} / -${Number(item.deleted || 0)}</strong>
          <small>${Number(item.unchanged || 0)} 首未变化</small>
        </div>
      `).join('') || '<div><span>暂无平台变化</span><strong>+0 / -0</strong><small>等待刷新</small></div>'}
    </div>
    ${baselineExamples.length ? `
      <div class="product-baseline-examples">
        <h5>变化示例</h5>
        <div class="product-baseline-example-grid">
          ${baselineExamples.map((item) => `
            <article class="product-baseline-example">
              <span>${escapeProductHtml(`${PRODUCT_LABELS[item.platform] || item.platform} · ${baselineDiffActionText(item.action)}`)}</span>
              <strong>${escapeProductHtml(baselineDiffExampleTitle(item))}</strong>
              <small>${escapeProductHtml(baselineDiffExampleMeta(item))}</small>
            </article>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderProductRunAudit() {
  const node = document.querySelector('#productRunAudit');
  if (!node) return;
  const runs = productState.app?.syncRuns || {};
  const run = productState.app?.lastSyncRun || null;
  if (!run) {
    node.innerHTML = `
      <div class="product-run-audit-head">
        <div>
          <h4>最近执行记录</h4>
          <p>新增和删除通过受控执行后，会在这里显示最近一次结果。Agent 或 AI 建议不会直接写入平台。</p>
        </div>
      </div>
      <div class="product-baseline-empty">暂无受控执行记录。</div>
    `;
    return;
  }

  const runTime = run.completedAt || run.ranAt || '';
  const action = syncRunActionText(run.action);
  const status = syncRunStatusText(run.status, run.dryRun);
  const target = syncRunTargetText(run.target);
  node.innerHTML = `
    <div class="product-run-audit-head">
      <div>
        <h4>最近执行记录</h4>
        <p>${escapeProductHtml(runTime ? `最近执行于 ${formatProductTime(runTime)}。` : '已记录最近一次受控执行。')}历史记录共 ${Number(runs.count || 0)} 次，保存在本机审计日志。</p>
      </div>
      <span class="product-state-pill ${escapeProductAttr(syncRunStatusClass(run.status, run.dryRun))}">${escapeProductHtml(status)}</span>
    </div>
    <div class="product-run-audit-grid">
      <div>
        <span>类型</span>
        <strong>${escapeProductHtml(action)}</strong>
        <small>${escapeProductHtml(syncRunPolicyText(run.policy))}</small>
      </div>
      <div>
        <span>目标</span>
        <strong>${escapeProductHtml(target)}</strong>
        <small>${run.dryRun ? '模拟执行，不写平台' : '真实写入路径'}</small>
      </div>
      <div>
        <span>新增</span>
        <strong>${Number(run.add?.accepted || run.add?.added || 0)} / ${Number(run.add?.requested || 0)}</strong>
        <small>${Number(run.add?.blocked || 0)} 个被阻止</small>
      </div>
      <div>
        <span>删除</span>
        <strong>${Number(run.remove?.removed || run.remove?.accepted || 0)} / ${Number(run.remove?.requested || 0)}</strong>
        <small>${Number(run.remove?.blocked || 0)} 个被阻止</small>
      </div>
    </div>
  `;
}

function renderProductConvergenceSummary() {
  const summary = document.querySelector('#productConvergenceSummary');
  const hint = document.querySelector('#productConvergenceHint');
  const card = document.querySelector('#productConvergenceCard');
  const convergence = currentProductConvergence();
  if (!convergence?.exists && !convergence?.status) {
    if (summary) summary.textContent = '待检查';
    if (hint) hint.textContent = '执行后刷新平台快照并重新计算，确认是否还有差异。';
    card?.classList.remove('is-good', 'is-warning', 'is-error');
    return;
  }
  if (summary) summary.textContent = convergenceSummaryText(convergence);
  if (hint) hint.textContent = convergenceHintText(convergence);
  card?.classList.toggle('is-good', Boolean(convergence.converged));
  card?.classList.toggle('is-error', convergence.status === 'refresh_failed');
  card?.classList.toggle('is-warning', !convergence.converged && convergence.status !== 'refresh_failed');
}

function renderProductWriteReadiness() {
  const node = document.querySelector('#productWriteReadiness');
  if (!node) return;
  const readiness = productWriteReadiness();
  node.className = `product-write-readiness ${readiness.ok ? 'is-ok' : 'is-warning'}`;
  node.innerHTML = `
    <div class="product-write-readiness-head">
      <div>
        <h4>${readiness.ok ? '真实写入就绪' : '真实写入暂不可用'}</h4>
        <p>${escapeProductHtml(readiness.ok
          ? '目标平台的一次性 add/remove 验证有效；可以执行真实新增或已确认删除。'
          : '你仍然可以模拟新增、查找候选和处理删除意图；真实写入前需要补齐验证。')}</p>
      </div>
      <span class="product-state-pill ${readiness.ok ? 'completed' : 'needs_attention'}">${readiness.ok ? '可执行' : '需验证'}</span>
    </div>
    <div class="product-write-readiness-targets">
      ${readiness.targets.map((item) => `
        <div class="${item.ok ? 'is-ok' : 'is-warning'}">
          <span>${escapeProductHtml(PRODUCT_LABELS[item.target] || item.target)}</span>
          <strong>${escapeProductHtml(item.ok ? '已验证' : writeReadinessStatusText(item.status))}</strong>
          <small>${escapeProductHtml(item.detail)}</small>
        </div>
      `).join('')}
    </div>
  `;
}

function renderProductResolutionSummary() {
  const node = document.querySelector('#productResolutionSummary');
  if (!node) return;
  const resolution = productState.lastResolution || productState.preview?.addResolution;
  if (!resolution?.resolvedAt && !resolution?.total && !resolution?.skipped) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }
  node.hidden = false;
  const targets = resolution.targets || [];
  node.innerHTML = `
    <div>
      <strong>对应歌曲查找结果</strong>
      <p>已处理 ${Number(resolution.total || 0)} 首，找到 ${Number(resolution.resolved || 0)} 首，需复核 ${Number(resolution.review || 0)} 首，未找到 ${Number(resolution.notFound || 0)} 首。</p>
    </div>
    <div class="product-resolution-targets">
      ${targets.map((item) => `
        <span title="${escapeProductAttr(resolutionReasonText(item.reason))}">
          ${escapeProductHtml(PRODUCT_LABELS[item.target] || item.target)}：
          ${item.skipped ? resolutionReasonText(item.reason) : `${Number(item.resolved || 0)} 可新增 / ${Number(item.review || 0)} 复核 / ${Number(item.notFound || 0)} 未找到`}
        </span>
      `).join('')}
    </div>
  `;
}

function renderProductPreviewList() {
  const node = document.querySelector('#productPreviewList');
  if (!node) return;
  const items = productState.preview?.items || [];
  const displayItems = productState.bucket === 'may_delete'
    ? filteredProductTombstoneItems(items)
    : items;
  renderProductTombstoneRisk();
  renderProductAddBulk(displayItems);
  renderProductTombstoneBulk(items, displayItems);
  if (!displayItems.length) {
    renderProductPreviewEmpty('这个分类下暂时没有条目。');
    return;
  }
  node.innerHTML = displayItems.map((item) => `
    <article class="product-preview-item">
      <div class="product-preview-title">
        <div>
          <h4>${escapeProductHtml(item.title || '未命名歌曲')}</h4>
          <p>${escapeProductHtml([item.artist, item.album].filter(Boolean).join(' / ') || '暂无艺人和专辑信息')}</p>
        </div>
        <span class="product-bucket-pill ${escapeProductAttr(item.bucket)}">${bucketText(item.bucket)}</span>
      </div>
      <div class="product-preview-meta">
        <span>${actionText(item.action)}</span>
        <span>${statusText(item.status)}</span>
        <span>${platformListText(item.targetPlatforms, '目标')}</span>
      </div>
      ${productResolutionDetails(item)}
      <div class="product-evidence-row">${evidenceText(item.evidence)}</div>
      <div class="product-preview-actions">
        <button class="product-mini-button" type="button" data-product-explain="${escapeProductAttr(item.id)}">解释</button>
      </div>
      ${productTombstoneControls(item)}
    </article>
  `).join('');
  node.querySelectorAll('[data-product-explain]').forEach((button) => {
    button.addEventListener('click', () => explainProductPreviewItem(button.dataset.productExplain));
  });
  node.querySelectorAll('[data-product-add-decision]').forEach((button) => {
    button.addEventListener('click', () => applyProductAddDecision({
      operationId: button.dataset.operationId,
      action: button.dataset.productAddDecision,
      alternativeIndex: button.dataset.alternativeIndex,
    }));
  });
  node.querySelectorAll('[data-product-tombstone-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const payload = {
        tombstoneKey: button.dataset.tombstoneKey,
        operationId: button.dataset.operationId,
        sourcePlatform: button.dataset.sourcePlatform,
      };
      const action = button.dataset.productTombstoneAction;
      if (action === 'confirm_global_delete') {
        openProductTombstoneDialog(payload);
        return;
      }
      applyProductTombstoneDecision({
        ...payload,
        action,
        platform: payload.sourcePlatform,
      });
    });
  });
}

async function applyProductAddDecision(input = {}) {
  if (!input.operationId || !input.action) return;
  await withProductBusy('正在保存新增候选决策', async () => {
    const result = await productPost('/api/sync/addition-decision', {
      operationId: input.operationId,
      action: input.action,
      alternativeIndex: input.alternativeIndex !== undefined ? Number(input.alternativeIndex) : undefined,
    });
    productState.lastResolution = result.addResolution || productState.lastResolution;
    setProductFeedback(productAddDecisionFeedback(result.operation));
    await loadProductPreview(productState.bucket);
    return result;
  });
}

function renderProductAddBulk(displayItems = []) {
  const node = document.querySelector('#productAddBulk');
  if (!node) return;
  const items = displayItems.filter(productCanBatchAddCandidate);
  if (!items.length) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }
  node.hidden = false;
  node.innerHTML = `
    <div class="product-tombstone-bulk-copy">
      <strong>当前列表有 ${items.length} 个新增候选需要复核</strong>
      <span>批量接受只会把候选标记为可新增；真正写入仍需要单独点击执行新增。备选项仍需逐条选择。</span>
    </div>
    <div class="product-tombstone-actions">
      <button class="product-mini-button" type="button" data-product-add-bulk="accept_candidate">批量接受候选</button>
      <button class="product-mini-button" type="button" data-product-add-bulk="skip">批量跳过</button>
    </div>
  `;
  const operationIds = items.map((item) => item.id).filter(Boolean);
  node.querySelectorAll('[data-product-add-bulk]').forEach((button) => {
    button.addEventListener('click', () => applyProductAddDecisionBatch(button.dataset.productAddBulk, operationIds));
  });
}

function productCanBatchAddCandidate(item = {}) {
  return item.action === 'add' && item.status === 'needs_review' && Boolean(item.candidateTarget);
}

async function applyProductAddDecisionBatch(action, operationIds = []) {
  const ids = [...new Set(operationIds.filter(Boolean))];
  if (!action || !ids.length) {
    setProductFeedback('当前列表没有可批量处理的新增候选。', true);
    return;
  }
  await withProductBusy('正在批量保存新增候选决策', async () => {
    const result = await productPost('/api/sync/addition-decisions', {
      action,
      operationIds: ids,
    });
    productState.lastResolution = result.addResolution || productState.lastResolution;
    setProductFeedback(productAddDecisionBatchFeedback(result));
    await loadProductPreview(productState.bucket);
    return result;
  });
}

async function explainProductPreviewItem(operationId) {
  if (!operationId) return;
  await withProductBusy('正在生成解释', async () => {
    const result = await productPost('/api/ai/explain', {
      operationId,
      useModel: false,
    });
    renderProductAiResult([
      result.explanation?.summary || '已生成解释。',
      result.explanation?.rationale || '',
      `建议：${explanationActionText(result.explanation?.recommendedAction)}`,
      `证据：${(result.explanation?.evidenceRefs || []).join('、') || '基础曲目信息'}`,
    ].filter(Boolean));
    setProductFeedback('已生成本地证据解释。');
    activateProductPage('ai');
    return result;
  });
}

function renderProductTombstoneRisk() {
  const node = document.querySelector('#productTombstoneRisk');
  if (!node) return;
  const risk = productState.tombstoneRisk;
  if (productState.bucket !== 'may_delete' || (!risk?.total && !risk?.error)) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }
  node.hidden = false;
  if (risk.error) {
    node.innerHTML = `
      <div class="product-tombstone-risk-head">
        <strong>删除风险复核暂不可用</strong>
        <span>${escapeProductHtml(risk.error)}</span>
      </div>
    `;
    return;
  }
  const groups = Array.isArray(risk.groups) ? risk.groups : [];
  const priorityItems = (risk.items || [])
    .filter((item) => item.group === 'needs_review' || item.risk === 'high')
    .slice(0, 3);
  node.innerHTML = `
    <div class="product-tombstone-risk-head">
      <div>
        <strong>AI 删除风险复核</strong>
        <span>${escapeProductHtml(tombstoneRiskSummaryText(risk))}</span>
      </div>
      <span class="product-risk-pill ${escapeProductAttr(risk.summary?.highestRisk || 'none')}">${riskText(risk.summary?.highestRisk || 'none')}</span>
    </div>
    <div class="product-tombstone-risk-groups">
      ${groups.map((group) => `
        <div class="product-tombstone-risk-group">
          <span>${escapeProductHtml(group.label || group.id)}</span>
          <strong>${Number(group.count || 0)}</strong>
          <small>${escapeProductHtml(group.description || '')}</small>
        </div>
      `).join('')}
    </div>
    ${priorityItems.length ? `
      <div class="product-tombstone-risk-items">
        ${priorityItems.map((item) => `
          <div>
            <strong>${escapeProductHtml(trackSummaryText(item))}</strong>
            <span>${escapeProductHtml(item.summary || '')}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function renderProductTombstoneBulk(items = [], displayItems = []) {
  const node = document.querySelector('#productTombstoneBulk');
  if (!node) return;
  const tombstoneItems = items.filter((item) => item.tombstoneKey);
  if (productState.bucket !== 'may_delete' || !tombstoneItems.length) {
    node.innerHTML = '';
    node.hidden = true;
    return;
  }
  const filteredItems = displayItems.filter((item) => item.tombstoneKey);
  const counts = tombstoneFilterCounts(tombstoneItems);
  node.hidden = false;
  node.innerHTML = `
    <div class="product-tombstone-bulk-copy">
      <strong>当前筛选 ${filteredItems.length} / ${tombstoneItems.length} 个删除信号</strong>
      <span>默认只处理未处理信号；批量操作不会执行全局删除，全局删除仍需逐条确认。</span>
    </div>
    <div class="product-tombstone-filters" aria-label="删除信号筛选">
      ${tombstoneFilterButton('undecided', '未处理', counts.undecided)}
      ${tombstoneFilterButton('qq', 'QQ 删除', counts.qq)}
      ${tombstoneFilterButton('netease', '网易云删除', counts.netease)}
      ${tombstoneFilterButton('decided', '已处理', counts.decided)}
      ${tombstoneFilterButton('all', '全部', counts.all)}
    </div>
    <div class="product-tombstone-actions">
      <button class="product-mini-button" type="button" data-product-tombstone-bulk="ignore">批量忽略</button>
      <button class="product-mini-button" type="button" data-product-tombstone-bulk="current_platform_only">批量仅当前平台</button>
      <button class="product-mini-button" type="button" data-product-tombstone-bulk="restore">批量恢复</button>
    </div>
  `;
  node.querySelectorAll('[data-product-tombstone-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      productState.tombstoneFilter = button.dataset.productTombstoneFilter || 'undecided';
      renderProductPreviewList();
    });
  });
  node.querySelectorAll('[data-product-tombstone-bulk]').forEach((button) => {
    button.addEventListener('click', () => applyProductTombstoneBatch(button.dataset.productTombstoneBulk));
  });
}

function tombstoneFilterButton(filter, label, count) {
  const active = productState.tombstoneFilter === filter;
  return `
    <button class="product-tombstone-filter ${active ? 'active' : ''}" type="button" data-product-tombstone-filter="${filter}">
      <span>${escapeProductHtml(label)}</span>
      <strong>${Number(count || 0)}</strong>
    </button>
  `;
}

function filteredProductTombstoneItems(items = []) {
  const filter = productState.tombstoneFilter || 'undecided';
  const tombstoneItems = items.filter((item) => item.tombstoneKey);
  if (filter === 'all') return tombstoneItems;
  if (filter === 'decided') return tombstoneItems.filter((item) => Boolean(item.tombstoneAction));
  if (filter === 'undecided') return tombstoneItems.filter((item) => !item.tombstoneAction);
  if (filter === 'qq' || filter === 'netease') {
    return tombstoneItems.filter((item) => (item.sourcePlatform || item.sourcePlatforms?.[0] || '') === filter);
  }
  return tombstoneItems;
}

function tombstoneFilterCounts(items = []) {
  return {
    all: items.length,
    undecided: items.filter((item) => !item.tombstoneAction).length,
    decided: items.filter((item) => Boolean(item.tombstoneAction)).length,
    qq: items.filter((item) => (item.sourcePlatform || item.sourcePlatforms?.[0] || '') === 'qq').length,
    netease: items.filter((item) => (item.sourcePlatform || item.sourcePlatforms?.[0] || '') === 'netease').length,
  };
}

function productResolutionDetails(item = {}) {
  if (item.action !== 'add') return '';
  const target = item.resolvedTarget || item.candidateTarget;
  const score = item.score !== null && item.score !== undefined ? ` · ${Math.round(Number(item.score || 0) * 100)}%` : '';
  if (item.resolvedTarget) {
    return `
      <div class="product-resolution-detail is-ready">
        <strong>已找到对应歌曲</strong>
        <span>${escapeProductHtml(trackSummaryText(target))}${score}</span>
      </div>
    `;
  }
  if (item.candidateTarget) {
    return `
      <div class="product-resolution-detail is-review">
        <strong>找到候选，需复核</strong>
        <span>${escapeProductHtml(trackSummaryText(target))}${score}</span>
      </div>
      ${productAddDecisionControls(item)}
    `;
  }
  if (item.resolution?.reason || item.status === 'not_found') {
    return `
      <div class="product-resolution-detail is-missing">
        <strong>${item.status === 'not_found' ? '目标平台未找到' : '等待查找对应歌曲'}</strong>
        <span>${escapeProductHtml(resolutionReasonText(item.resolution?.reason || item.status))}</span>
      </div>
    `;
  }
  if (item.status === 'needs_resolution') {
    return `
      <div class="product-resolution-detail">
        <strong>等待查找对应歌曲</strong>
        <span>执行新增前需要先在目标平台确认可写入的歌曲。</span>
      </div>
    `;
  }
  return '';
}

function productAddDecisionControls(item = {}) {
  const alternatives = Array.isArray(item.alternatives) ? item.alternatives.slice(0, 3) : [];
  return `
    <div class="product-add-decision-panel">
      <div class="product-add-decision-copy">
        <span>${escapeProductHtml(productAddDecisionText(item))}</span>
        <small>${escapeProductHtml(item.blockedReason ? resolutionReasonText(item.blockedReason) : '接受后才会进入新增执行；跳过不会写入平台。')}</small>
      </div>
      <div class="product-tombstone-actions">
        <button
          class="product-mini-button"
          type="button"
          data-product-add-decision="accept_candidate"
          data-operation-id="${escapeProductAttr(item.id)}"
        >接受候选</button>
        ${alternatives.map((track, index) => `
          <button
            class="product-mini-button"
            type="button"
            title="${escapeProductAttr(trackSummaryText(track))}"
            data-product-add-decision="select_alternative"
            data-operation-id="${escapeProductAttr(item.id)}"
            data-alternative-index="${index}"
          >备选 ${index + 1}</button>
        `).join('')}
        <button
          class="product-mini-button"
          type="button"
          data-product-add-decision="skip"
          data-operation-id="${escapeProductAttr(item.id)}"
        >跳过</button>
      </div>
    </div>
  `;
}

function productTombstoneControls(item) {
  if (!item.tombstoneKey) return '';
  const sourcePlatform = item.sourcePlatform || item.sourcePlatforms?.[0] || '';
  const buttons = [
    ['ignore', '忽略'],
    ['current_platform_only', '仅当前平台'],
    ['restore', '恢复'],
    ['confirm_global_delete', '全局删除'],
  ];
  return `
    <div class="product-tombstone-panel">
      <div class="product-tombstone-copy">
        <span>${escapeProductHtml(tombstoneActionText(item.tombstoneAction))}</span>
        <small>${escapeProductHtml(sourcePlatform ? `${PRODUCT_LABELS[sourcePlatform] || sourcePlatform} 删除信号` : '删除信号')}</small>
      </div>
      <div class="product-tombstone-actions">
        ${buttons.map(([action, label]) => `
          <button
            class="product-mini-button ${action === 'confirm_global_delete' ? 'danger' : ''}"
            type="button"
            data-product-tombstone-action="${escapeProductAttr(action)}"
            data-tombstone-key="${escapeProductAttr(item.tombstoneKey)}"
            data-operation-id="${escapeProductAttr(item.id)}"
            data-source-platform="${escapeProductAttr(sourcePlatform)}"
          >${escapeProductHtml(label)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderProductPreviewEmpty(message) {
  const node = document.querySelector('#productPreviewList');
  if (!node) return;
  node.innerHTML = `<div class="product-preview-empty">${escapeProductHtml(message)}</div>`;
}

function renderProductAi() {
  const node = document.querySelector('#productAiGrid');
  if (!node) return;
  node.innerHTML = PRODUCT_AI_CAPABILITIES.map((item) => `
    <article class="product-ai-card is-coming">
      <div class="product-card-head">
        <h4>${escapeProductHtml(item.title)}</h4>
        <span class="product-state-pill">${escapeProductHtml(item.status)}</span>
      </div>
      <p>${escapeProductHtml(item.body)}</p>
    </article>
  `).join('');
}

async function loadProductAgentSessions(options = {}) {
  try {
    const result = await productGet('/api/agent/sessions?limit=3&traceLimit=5');
    productState.agentSessions = result;
    productState.agentSessionsLoaded = true;
    renderProductAgentAudit();
    if (!options.silent) setProductFeedback('已刷新 Agent 工具审计。');
    return result;
  } catch (error) {
    productState.agentSessions = { error: error.message || 'Agent 工具审计暂时不可用。' };
    productState.agentSessionsLoaded = true;
    renderProductAgentAudit();
    if (!options.silent) setProductFeedback(productState.agentSessions.error, true);
    return null;
  }
}

function renderProductAgentAudit() {
  const list = document.querySelector('#productAgentAuditList');
  const summary = document.querySelector('#productAgentAuditSummary');
  if (!list) return;
  const state = productState.agentSessions || {};
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const traces = sessions.flatMap((session) => (
    (session.toolTraces || []).map((trace) => ({ session, trace }))
  )).slice(0, 5);

  if (summary) {
    if (state.error) {
      summary.textContent = `读取失败：${state.error}`;
    } else if (!productState.agentSessionsLoaded) {
      summary.textContent = '正在读取最近的本机 Agent 工具调用摘要。';
    } else {
      summary.textContent = traces.length
        ? `最近 ${traces.length} 次只读工具调用；只展示摘要和证据引用。`
        : '还没有 Agent 工具调用记录；生成推荐或相似歌曲后可以回来刷新。';
    }
  }

  if (state.error) {
    list.innerHTML = `<div class="product-agent-empty">${escapeProductHtml(state.error)}</div>`;
    return;
  }
  if (!productState.agentSessionsLoaded) {
    list.innerHTML = '<div class="product-agent-empty">正在读取工具调用摘要。</div>';
    return;
  }
  if (!traces.length) {
    list.innerHTML = '<div class="product-agent-empty">暂无工具调用记录。</div>';
    return;
  }

  list.innerHTML = traces.map(({ session, trace }) => `
    <article class="product-agent-trace">
      <div class="product-agent-trace-head">
        <div>
          <strong>${escapeProductHtml(agentToolLabel(trace.tool))}</strong>
          <span>${escapeProductHtml(agentTraceStatusText(trace.status))} · ${escapeProductHtml(trace.source || session.source || 'product-ui')}</span>
        </div>
        <span class="product-state-pill ${trace.status === 'completed' ? 'readable' : 'needs_attention'}">${trace.readOnly === false ? '需复核' : '只读'}</span>
      </div>
      <div class="product-agent-trace-meta">
        <span>${formatProductTime(trace.calledAt || session.updatedAt || session.startedAt)}</span>
        <span>${Number(trace.durationMs || 0)} ms</span>
        <span>${trace.mutatesProvider ? '可能写入' : '不写平台'}</span>
      </div>
      <div class="product-agent-evidence">
        ${(trace.evidenceRefs || []).slice(0, 6).map((item) => `<span>${escapeProductHtml(item)}</span>`).join('') || '<span>local_summary</span>'}
      </div>
      <div class="product-agent-kv">
        <div>
          <span>参数摘要</span>
          ${renderAgentSummaryEntries(trace.argumentsSummary)}
        </div>
        <div>
          <span>结果摘要</span>
          ${renderAgentSummaryEntries(trace.resultSummary)}
        </div>
      </div>
      <div class="product-agent-feedback-row">
        <span>反馈：${escapeProductHtml(agentFeedbackText(trace.feedback?.label))}</span>
        <div>
          ${['useful', 'not_enough_evidence', 'incorrect'].map((label) => `
            <button
              class="product-mini-button ${trace.feedback?.label === label ? 'active' : ''}"
              type="button"
              data-agent-feedback="${escapeProductAttr(label)}"
              data-agent-session-id="${escapeProductAttr(session.id)}"
              data-agent-trace-id="${escapeProductAttr(trace.id || trace.traceId || '')}"
            >${escapeProductHtml(agentFeedbackText(label))}</button>
          `).join('')}
        </div>
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-agent-feedback]').forEach((button) => {
    button.addEventListener('click', () => saveProductAgentFeedback(button));
  });
}

async function saveProductAgentFeedback(button) {
  const label = button.dataset.agentFeedback || '';
  const sessionId = button.dataset.agentSessionId || '';
  const traceId = button.dataset.agentTraceId || '';
  if (!sessionId || !traceId) {
    setProductFeedback('这条 Agent 审计记录缺少反馈标识，请刷新后重试。', true);
    return;
  }
  button.disabled = true;
  try {
    const result = await productPost('/api/agent/trace-feedback', {
      sessionId,
      traceId,
      label,
      limit: 3,
      traceLimit: 5,
    });
    productState.agentSessions = result.sessions || productState.agentSessions;
    productState.agentSessionsLoaded = true;
    renderProductAgentAudit();
    setProductFeedback(`已记录 Agent 反馈：${agentFeedbackText(label)}。`);
  } catch (error) {
    setProductFeedback(error.message || 'Agent 反馈保存失败。', true);
  } finally {
    button.disabled = false;
  }
}

function renderProductAiProviderStatus() {
  const provider = productState.app?.ai?.provider || {};
  const hasKey = Boolean(provider.hasApiKey || productState.app?.ai?.configured);
  const configured = Boolean(provider.configured || hasKey);
  const consent = Boolean(document.querySelector('#productAiProviderConsent')?.checked);
  const pill = document.querySelector('#productAiProviderPill');
  const copy = document.querySelector('#productAiProviderCopy');
  const meta = document.querySelector('#productAiProviderMeta');
  const button = document.querySelector('#productAiProviderTestButton');
  const profileModelButton = document.querySelector('#productProfileModelButton');
  const recommendationModelButton = document.querySelector('#productRecommendModelButton');
  const result = document.querySelector('#productAiProviderResult');
  const lastTest = productState.lastAiProviderTest;

  if (pill) {
    pill.textContent = lastTest?.ok ? '已通过' : configured ? '已配置' : '未配置';
    pill.className = `product-state-pill ${lastTest?.ok ? 'readable' : configured ? 'writable' : 'not_connected'}`;
  }
  if (copy) {
    copy.textContent = configured
      ? `${providerDisplayName(provider.provider)} / ${provider.model || productState.app?.ai?.model || '默认模型'}，只在你勾选同意并点击测试时发起外部调用。`
      : '需要先在本机配置 AI API key；未配置时本地画像、推荐和相似歌仍可使用。';
  }
  if (meta) {
    const parts = [
      provider.provider ? `Provider：${providerDisplayName(provider.provider)}` : '',
      provider.model ? `Model：${provider.model}` : '',
      provider.baseUrl ? `Base URL：${provider.baseUrl}` : '',
      hasKey ? 'Key：本机已检测到' : 'Key：未检测到',
    ].filter(Boolean);
    meta.innerHTML = parts.map((item) => `<span>${escapeProductHtml(item)}</span>`).join('');
  }
  if (button) {
    button.disabled = productState.busy || !hasKey || !consent;
  }
  if (profileModelButton) {
    profileModelButton.disabled = productState.busy || !hasKey || !consent;
  }
  if (recommendationModelButton) {
    recommendationModelButton.disabled = productState.busy || !hasKey || !consent;
  }
  if (result && lastTest) {
    result.textContent = `最近自检：${lastTest.ok ? '通过' : '失败'}，${formatProductTime(lastTest.checkedAt)}，${providerDisplayName(lastTest.provider)} / ${lastTest.model || '默认模型'}，${formatAiUsage(lastTest.usage)}。`;
  } else if (result && !configured) {
    result.textContent = '未配置 API key 时不会显示外部 AI 测试；本地 AI 辅助能力仍然可用。';
  }
}

function renderProductAdvancedStatus() {
  const live = productState.app?.validation?.live;
  const livePill = document.querySelector('#productAdvancedLivePill');
  const liveCopy = document.querySelector('#productAdvancedLiveCopy');
  const aiPill = document.querySelector('#productAdvancedAiPill');
  const aiCopy = document.querySelector('#productAdvancedAiCopy');
  if (livePill) {
    livePill.textContent = live?.ok ? '已通过' : '需验证';
    livePill.className = `product-state-pill ${live?.ok ? 'readable' : 'needs_attention'}`;
  }
  if (liveCopy) {
    const qq = live?.targets?.qq?.status || 'missing';
    const netease = live?.targets?.netease?.status || 'missing';
    liveCopy.textContent = `QQ：${liveStatusText(qq)}；网易云：${liveStatusText(netease)}。`;
  }
  const provider = productState.app?.ai?.provider || {};
  if (aiPill) {
    aiPill.textContent = provider.configured || provider.hasApiKey ? '已配置' : '未配置';
    aiPill.className = `product-state-pill ${provider.configured || provider.hasApiKey ? 'readable' : 'not_connected'}`;
  }
  if (aiCopy) {
    aiCopy.textContent = provider.configured || provider.hasApiKey
      ? `${providerDisplayName(provider.provider)} / ${provider.model || productState.app?.ai?.model || '默认模型'}，key 只在本机环境中检测。`
      : '未检测到 AI key；本地画像、推荐和相似歌曲仍可使用。';
  }
}

function liveStatusText(status) {
  if (status === 'verified') return '已通过';
  if (status === 'stale') return '需更新';
  if (status === 'missing') return '未验证';
  return '异常';
}

function renderProductAiResult(lines = []) {
  const node = document.querySelector('#productAiResult');
  if (!node) return;
  node.innerHTML = lines.length
    ? lines.map((line) => `<div>${escapeProductHtml(line)}</div>`).join('')
    : '暂无结果。';
}

function platformAction(platform) {
  if (platform.id === 'apple') {
    return `<button class="product-button" type="button" data-product-proxy="#appleBrowserOpenButton">打开 Apple 登录</button>`;
  }
  if (platform.id === 'qq') {
    return `<button class="product-button" type="button" data-product-proxy="#qqBrowserOpenButton">QQ 扫码登录</button>`;
  }
  if (platform.id === 'netease') {
    return `<button class="product-button" type="button" data-product-proxy="#neteaseQrButton">网易云扫码</button>`;
  }
  return '';
}

function platformCopy(platform) {
  const caps = platform.capabilities || {};
  if (platform.id === 'apple') return caps.read ? '可信源已可读取。' : '需要导入 Apple Music 喜欢歌曲或登录后抓取。';
  if (caps.write) return '已保存凭据，可以读取并写入喜欢歌单。';
  if (caps.read) return '已可读取，需要补全写入凭据。';
  return '等待扫码或浏览器授权。';
}

function platformLiveValidation(platform) {
  if (platform !== 'qq' && platform !== 'netease') return '';
  const evidence = productState.app?.validation?.live?.targets?.[platform];
  if (!evidence) return '';
  const ok = evidence.ok === true;
  const status = evidence.status || 'missing';
  const title = ok ? '真实写入验证已通过' : status === 'missing' ? '尚未真实写入验证' : '真实写入验证需更新';
  const detail = ok
    ? `${formatProductTime(evidence.validatedAt)}，已验证新增和删除`
    : status === 'stale'
    ? '报告已过期，需要重新跑 disposable playlist 验证'
    : '需要一次性歌单 add/remove 验证后再开放为发布证据';
  return `
    <div class="product-validation-row ${ok ? 'is-ok' : 'is-warning'}">
      <span>${escapeProductHtml(title)}</span>
      <small>${escapeProductHtml(detail)}</small>
    </div>
  `;
}

function activateProductPage(page) {
  document.querySelectorAll('[data-product-page]').forEach((button) => {
    button.classList.toggle('active', button.dataset.productPage === page);
  });
  document.querySelectorAll('[data-product-page-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.productPagePanel === page);
  });
  document.body.classList.toggle('product-advanced-open', page === 'advanced');
  if (page === 'ai' && !productState.agentSessionsLoaded) {
    loadProductAgentSessions({ silent: true });
  }
}

function applyProductInitialRoute() {
  const page = window.location.hash === '#advanced' ? 'advanced' : '';
  if (!page) return;
  activateProductPage(page);
  window.setTimeout(() => {
    document.querySelector('.workspace > .grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

function primaryProductTarget() {
  return [...productState.targets][0] || 'qq';
}

function selectedProductTargets() {
  const targets = [...productState.targets].filter((target) => target === 'qq' || target === 'netease');
  return targets.length ? targets : [primaryProductTarget()];
}

function productWriteReadiness(targets = selectedProductTargets()) {
  const liveTargets = productState.app?.validation?.live?.targets || {};
  const rows = targets.map((target) => {
    const evidence = liveTargets[target] || {};
    const ok = evidence.ok === true;
    const status = evidence.status || 'missing';
    return {
      target,
      ok,
      status,
      detail: ok
        ? `${formatProductTime(evidence.validatedAt)}，新增和删除已验证`
        : status === 'stale'
        ? '验证报告已过期，需要重新跑一次 disposable playlist 验证'
        : status === 'invalid'
        ? '验证报告不完整，需要重新生成'
        : '缺少验证报告，需要先完成一次真实 add/remove 验证',
    };
  });
  const blocked = rows.filter((item) => !item.ok);
  const names = blocked.map((item) => PRODUCT_LABELS[item.target] || item.target).join('、');
  return {
    ok: blocked.length === 0,
    targets: rows,
    message: blocked.length
      ? `真实写入前需要完成 ${names} 的 live validation；模拟和本地复核仍可继续。`
      : '目标平台 live validation 已通过。',
  };
}

function productDeleteExpected(targets) {
  return targets.length > 1 ? 'DELETE FROM SELECTED TARGETS' : `DELETE FROM ${targets[0].toUpperCase()}`;
}

function productCurrentMode() {
  return productState.preview?.mode || productState.mode || productState.app?.syncMode?.id || 'canonical_mirror';
}

function productUsesTombstoneDeletion() {
  return productCurrentMode() === 'managed_bidirectional';
}

function productAllowsDeleteExecution() {
  return productCurrentMode() === 'canonical_mirror' || productUsesTombstoneDeletion();
}

function productTombstoneExpected(platform) {
  return `CONFIRM GLOBAL DELETE FROM ${String(platform || '').trim().toUpperCase()}`;
}

function proxyClick(selector) {
  const target = document.querySelector(selector);
  if (!target) {
    setProductFeedback('高级工作台中没有找到对应动作。', true);
    return;
  }
  target.click();
}

async function withProductBusy(message, action) {
  setProductBusy(true);
  setProductFeedback(message);
  try {
    const result = await action();
    const currentFeedback = document.querySelector('#productFeedback')?.textContent || '';
    if (message && currentFeedback === message) setProductFeedback(`${message}完成。`);
    return result;
  } catch (error) {
    setProductFeedback(error.message || '操作失败。', true);
  } finally {
    setProductBusy(false);
  }
}

function setProductBusy(nextBusy) {
  productState.busy = nextBusy;
  document.querySelectorAll('.product-app button, .product-app input').forEach((control) => {
    if (control.id === 'productDeleteInput') return;
    if (control.id === 'productTombstoneInput') return;
    control.disabled = nextBusy;
  });
  refreshProductDeleteState();
  refreshProductTombstoneState();
  renderProductExecutionControls();
  renderProductAiProviderStatus();
}

function setProductFeedback(message, isError = false) {
  const node = document.querySelector('#productFeedback');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', Boolean(isError));
}

async function productGet(url) {
  return productFetch(url);
}

async function productPost(url, body) {
  return productFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

async function productFetch(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const message = payload.error?.message || payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data ?? payload;
}

function currentProductConvergence() {
  return productState.lastConvergence
    || productState.preview?.convergence
    || productState.app?.latestPreview?.convergence
    || null;
}

function convergenceSummaryText(convergence = {}) {
  if (convergence.status === 'refresh_failed') return '刷新失败';
  if (convergence.skippedReason === 'dry_run') return '模拟执行完成';
  if (convergence.skippedReason === 'disabled') return '未刷新快照';
  if (convergence.skippedReason === 'no_executable_operations') return '没有可执行变化';
  if (convergence.converged || convergence.status === 'converged') return '已一致';
  if (convergence.status === 'open_delta') return '仍有差异';
  if (convergence.status === 'skipped') return '未执行检查';
  return '已检查';
}

function convergenceHintText(convergence = {}) {
  if (convergence.error) return convergence.error;
  if (convergence.skippedReason === 'dry_run') return '这次是模拟执行，没有刷新平台快照；真实执行后会重新检查。';
  if (convergence.skippedReason === 'disabled') return '本次执行关闭了写入后的快照刷新。';
  if (convergence.skippedReason === 'no_executable_operations') return '没有真正写入平台，所以无需重新检查一致性。';
  const counts = convergence.counts || {};
  const open = Number(convergence.openOperations ?? (
    Number(counts.will_add || 0) + Number(counts.needs_confirmation || 0) + Number(counts.may_delete || 0)
  ));
  const parts = [
    `新增 ${Number(counts.will_add || 0)}`,
    `复核 ${Number(counts.needs_confirmation || 0)}`,
    `删除 ${Number(counts.may_delete || 0)}`,
  ];
  const refreshed = (convergence.refreshedTargets || []).map((target) => PRODUCT_LABELS[target] || target).join('、');
  const time = convergence.refreshedAt ? `检查于 ${formatProductTime(convergence.refreshedAt)}` : '已重新计算';
  if (convergence.converged || convergence.status === 'converged') {
    return `${time}${refreshed ? `，已刷新 ${refreshed}` : ''}，没有待处理差异。`;
  }
  return `${time}${refreshed ? `，已刷新 ${refreshed}` : ''}，仍有 ${open} 个待处理项：${parts.join(' / ')}。`;
}

function providerDisplayName(provider) {
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'local') return 'Local';
  return provider || 'AI Provider';
}

function agentToolLabel(tool) {
  const labels = {
    get_library_summary: '曲库摘要',
    get_sync_policy: '同步策略',
    get_sync_preview: '同步预览',
    get_taste_profile: '音乐画像',
    find_similar_tracks: '找相似歌曲',
    recommend_by_profile: '按画像推荐',
    draft_sync_operations: '同步草稿',
  };
  return labels[tool] ? `${labels[tool]} (${tool})` : tool || 'Agent 工具';
}

function agentTraceStatusText(status) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'blocked') return '已阻止';
  return status || '已记录';
}

function agentFeedbackText(label) {
  if (label === 'useful') return '有帮助';
  if (label === 'not_enough_evidence') return '证据不足';
  if (label === 'incorrect') return '不准确';
  return '未标记';
}

function renderAgentSummaryEntries(summary = {}) {
  const entries = Object.entries(summary || {}).filter(([, value]) => value !== undefined && value !== null).slice(0, 6);
  if (!entries.length) return '<small>无摘要</small>';
  return entries.map(([key, value]) => (
    `<small>${escapeProductHtml(key)}：${escapeProductHtml(formatAgentSummaryValue(value))}</small>`
  )).join('');
}

function formatAgentSummaryValue(value) {
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} 项`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  const text = String(value ?? '');
  return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

function formatAiUsage(usage = {}) {
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0);
  if (!total && !prompt && !completion) return 'provider 未返回用量';
  return `total ${total || prompt + completion}${prompt ? ` / input ${prompt}` : ''}${completion ? ` / output ${completion}` : ''}`;
}

function convergenceFeedbackText(convergence = {}) {
  return `${convergenceSummaryText(convergence)}：${convergenceHintText(convergence)}`;
}

function nextActionText(action) {
  if (action === 'choose_sync_mode') return '先选择同步方式。';
  if (action === 'run_sync_check') return '可以运行同步检查。';
  if (action === 'review_confirmation') return '有歌曲需要人工复核后再执行。';
  if (action === 'confirm_deletions') return '有删除候选，需单独确认。';
  if (action === 'execute_additions') return '可以先执行新增。';
  if (action === 'up_to_date') return '当前预览看起来已经一致。';
  return '可以从连接平台开始。';
}

function syncRunActionText(action) {
  if (action === 'remove') return '执行删除';
  if (action === 'add') return '执行新增';
  return '受控执行';
}

function syncRunStatusText(status, dryRun = false) {
  if (dryRun) return '模拟完成';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '执行中';
  if (status === 'duplicate') return '已跳过重复执行';
  return status || '已记录';
}

function syncRunStatusClass(status, dryRun = false) {
  if (dryRun) return 'dry-run';
  if (status === 'completed' || status === 'duplicate') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'recorded';
}

function syncRunPolicyText(policy) {
  const mode = productState.modes.find((item) => item.id === policy);
  if (mode?.label) return mode.label;
  if (policy === 'canonical_mirror') return '以 Apple Music 为准';
  if (policy === 'union_convergence') return '合并所有平台';
  if (policy === 'managed_bidirectional') return '自动同步新增，删除需确认';
  if (policy === 'read_only_analysis') return '只分析';
  return policy || '同步策略';
}

function syncRunTargetText(target) {
  if (!target) return '多个平台';
  if (target === 'multi') return '多个平台';
  return PRODUCT_LABELS[target] || target;
}

function writeReadinessStatusText(status) {
  if (status === 'stale') return '已过期';
  if (status === 'invalid') return '需重跑';
  if (status === 'missing') return '未验证';
  return status || '未验证';
}

function riskText(risk) {
  if (risk === 'none') return '无写入';
  if (risk === 'low') return '低风险';
  if (risk === 'medium') return '需确认';
  if (risk === 'high') return '高风险';
  return '模式';
}

function tombstoneRiskSummaryText(risk = {}) {
  const total = Number(risk.total || 0);
  const unhandled = Number(risk.summary?.unhandled || 0);
  const confirmed = Number(risk.summary?.confirmedGlobalDeletes || 0);
  const safe = Number(risk.summary?.safeDecisions || 0);
  if (!total) return '当前没有删除信号。';
  const parts = [`共 ${total} 条删除信号`];
  if (unhandled) parts.push(`${unhandled} 条未处理`);
  if (confirmed) parts.push(`${confirmed} 条已确认全局删除`);
  if (safe) parts.push(`${safe} 条已限制为安全处理`);
  return `${parts.join('，')}。`;
}

function bucketText(bucket) {
  const found = PRODUCT_BUCKETS.find(([id]) => id === bucket);
  return found ? found[1] : bucket || '条目';
}

function actionText(action) {
  if (action === 'add') return '新增到目标平台';
  if (action === 'remove') return '从目标平台删除';
  if (action === 'review') return '等待复核';
  return '保持';
}

function statusText(status) {
  if (status === 'ready') return '可执行';
  if (status === 'blocked') return '被阻止';
  if (status === 'needs_review') return '需判断';
  if (status === 'needs_resolution') return '待查找';
  if (status === 'not_found') return '未找到';
  return status || '未知状态';
}

function trackSummaryText(track = {}) {
  return [track.title, track.artist, track.album].filter(Boolean).join(' / ') || '未命名歌曲';
}

function baselineDiffActionText(action) {
  if (action === 'added') return '新增信号';
  if (action === 'deleted') return '删除信号';
  return '变化信号';
}

function baselineDiffExampleTitle(item = {}) {
  return [item.title, item.artist].filter(Boolean).join(' / ') || '未命名歌曲';
}

function baselineDiffExampleMeta(item = {}) {
  const evidence = Array.isArray(item.evidence)
    ? item.evidence.map((value) => baselineDiffEvidenceText(value)).filter(Boolean)
    : [];
  return [
    item.album || '',
    formatProductDuration(item.durationMs),
    evidence.length ? `证据：${evidence.join('、')}` : '',
  ].filter(Boolean).join(' · ') || '基础曲目信息';
}

function baselineDiffEvidenceText(value) {
  if (value === 'isrc') return 'ISRC';
  if (value === 'musicbrainz') return 'MusicBrainz';
  if (value === 'duration') return '时长';
  return value || '';
}

function resolutionReasonText(reason) {
  if (reason === 'missing_cookie') return '平台还未连接';
  if (reason === 'not_requested') return '本次未处理';
  if (reason === 'resolved_target_match') return '高置信匹配';
  if (reason === 'low_confidence_target_match') return '候选置信度不足';
  if (reason === 'user_accepted_candidate') return '已接受候选';
  if (reason === 'user_selected_alternative') return '已选择备选';
  if (reason === 'user_skipped_add_candidate') return '已跳过，不会写入';
  if (reason === 'decision_cleared') return '已清除手动决策';
  if (reason === 'target_catalog_not_found') return '目标平台没有搜索到候选';
  if (reason === 'target_catalog_low_score') return '搜索结果与源歌曲差异明显';
  if (reason === 'ai_rejected_candidate') return 'AI 复核已排除错误候选';
  if (reason === 'missing_source_track') return '源歌曲信息不足';
  if (reason === 'not_found') return '目标平台未找到';
  return reason || '等待查找';
}

function productAddDecisionText(item = {}) {
  if (item.addDecision?.action === 'accept_candidate') return '已接受当前候选';
  if (item.addDecision?.action === 'select_alternative') return '已选择备选候选';
  if (item.addDecision?.action === 'skip') return '已跳过这条新增';
  return '这个候选需要你确认';
}

function productAddDecisionFeedback(item = {}) {
  if (item.addDecision?.action === 'accept_candidate') return '已接受新增候选，后续会通过新增执行写入。';
  if (item.addDecision?.action === 'select_alternative') return '已选择备选歌曲，后续会通过新增执行写入。';
  if (item.addDecision?.action === 'skip') return '已跳过这条新增，不会写入平台。';
  return '新增候选决策已保存。';
}

function productAddDecisionBatchFeedback(result = {}) {
  const changed = Number(result.changed || 0);
  const skipped = Number(result.skipped || 0);
  const action = result.action || '';
  const verb = action === 'skip' ? '跳过' : action === 'clear' ? '清除' : '接受';
  const tail = skipped ? `，${skipped} 个未处理` : '';
  return `已批量${verb} ${changed} 个新增候选${tail}。`;
}

function productResolutionFeedback(resolution = {}) {
  const processed = Number(resolution?.total || 0);
  const resolved = Number(resolution?.resolved || 0);
  const review = Number(resolution?.review || 0);
  const notFound = Number(resolution?.notFound || 0);
  const skipped = Number(resolution?.skipped || 0);
  if (!processed && skipped) return '查找已完成，但有平台还未连接，无法搜索目标曲库。';
  return `查找完成：处理 ${processed} 首，找到 ${resolved} 首，需复核 ${review} 首，未找到 ${notFound} 首。`;
}

function tombstoneActionText(action) {
  if (action === 'confirm_global_delete') return '已确认全局删除';
  if (action === 'ignore') return '已忽略';
  if (action === 'restore') return '已选择恢复';
  if (action === 'current_platform_only') return '仅当前平台删除';
  return '等待处理';
}

function explanationActionText(action) {
  if (action === 'review_tombstone') return '先判断这个删除是否只属于当前平台';
  if (action === 'execute_confirmed_delete') return '通过受控删除执行';
  if (action === 'execute_addition') return '可以进入新增执行';
  if (action === 'resolve_before_add') return '先解析目标平台候选';
  if (action === 'review_manually') return '人工复核';
  if (action === 'keep') return '保持不变';
  return '继续复核';
}

function platformListText(platforms, prefix) {
  const names = (platforms || []).map((platform) => PRODUCT_LABELS[platform] || platform).filter(Boolean);
  return `${prefix}：${names.length ? names.join('、') : '未指定'}`;
}

function evidenceText(evidence = []) {
  if (!evidence.length) return '证据：基础曲目信息';
  return `证据：${evidence.join('、')}`;
}

function formatProductTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}

function formatProductDuration(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function escapeProductHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeProductAttr(value) {
  return escapeProductHtml(value).replace(/'/g, '&#39;');
}
