import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_CHECKOUT_FILES = [
  '.github/workflows/ci.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
];

function isSourceCheckout() {
  return SOURCE_CHECKOUT_FILES.every((file) => fs.existsSync(file));
}

describe('release readiness metadata', () => {
  it('keeps the old qq-music-api dependency out of the public package', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    };

    assert.equal(deps['qq-music-api'], undefined);
  });

  it('ships public-facing release documents', () => {
    for (const file of [
      'README.md',
      'README.zh-CN.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/PRODUCT_ROADMAP.md',
      'docs/AI_MUSIC_AGENT_PRD.zh-CN.md',
      'docs/UX_FLOW_SPEC.zh-CN.md',
      'docs/TECH_STACK_DECISION.zh-CN.md',
      'docs/IMPLEMENTATION_READINESS.zh-CN.md',
      'docs/API_CONTRACT.zh-CN.md',
      'docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md',
      'docs/PROVIDERS.md',
      'docs/USER_GUIDE.zh-CN.md',
      'docs/STATE.md',
      'docs/VALIDATION.md',
      'LICENSE',
      '.env.example',
      'scripts/check-ci-workflow.mjs',
      'scripts/privacy-smoke.mjs',
      'scripts/check-state.mjs',
      'scripts/migrate-state.mjs',
      'scripts/http-smoke.mjs',
      'scripts/web-app-smoke.mjs',
      'scripts/ui-smoke.mjs',
      'scripts/agent-mcp-smoke.mjs',
      'scripts/docker-smoke.mjs',
      'scripts/fetch-docker-report.mjs',
      'scripts/fresh-install-smoke.mjs',
      'scripts/package-smoke.mjs',
      'scripts/release-readiness.mjs',
      'scripts/live-provider-validation.mjs',
      'src/live-validation.js',
      'test/live-validation.test.js',
      'test/fetch-docker-report.test.js',
      'web-app/index.html',
      'web-app/vite.config.ts',
      'web-app/tsconfig.json',
      'web-app/src/app/App.tsx',
      'web-app/src/api/client.ts',
      'web-app/src/api/types.ts',
    ]) {
      assert.equal(fs.existsSync(file), true, `${file} should exist`);
    }

    if (isSourceCheckout()) {
      for (const file of SOURCE_CHECKOUT_FILES) {
        assert.equal(fs.existsSync(file), true, `${file} should exist in source checkout`);
      }
    }
  });

  it('publishes only intentional source, docs, tests, and validation scripts', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.deepEqual(pkg.bin, {
      'music-likes-sync': './src/cli.js',
    });
    assert.deepEqual(pkg.files, [
      'src/',
      'web/',
      'web-app/',
      'scripts/',
      'docs/',
      'examples/',
      'test/',
      'README.md',
      'README.zh-CN.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'LICENSE',
      '.env.example',
    ]);

    assert.equal(pkg.files.includes('data/'), false);
    assert.equal(pkg.files.includes('reports/'), false);
    assert.equal(pkg.files.includes('.env'), false);
    assert.equal(pkg.files.includes('Dockerfile'), false);
    assert.equal(pkg.files.includes('.dockerignore'), false);
    assert.equal(pkg.files.some((file) => file.includes('edge-profile')), false);
  });

  it('keeps the Node support policy aligned across package metadata, docs, and CI', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const readme = fs.readFileSync('README.md', 'utf8');
    const validationDocs = fs.readFileSync('docs/VALIDATION.md', 'utf8');

    assert.deepEqual(pkg.engines, {
      node: '>=20',
    });
    assert.match(readme, /Node\.js 20 or newer is required/);
    assert.match(validationDocs, /Node 20 and Node 24/);

    if (isSourceCheckout()) {
      const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
      assert.match(workflow, /workflow_dispatch:/);
      assert.match(workflow, /-\s+20\.x/);
      assert.match(workflow, /-\s+24\.x/);
    }
  });

  it('validates npm package CLI bin metadata', () => {
    const packageSmoke = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');
    const cli = fs.readFileSync('src/cli.js', 'utf8');

    assert.match(cli, /^#!\/usr\/bin\/env node/u);
    assert.match(packageSmoke, /packageBinProblems/);
    assert.match(packageSmoke, /bin target is not included in npm pack output/);
    assert.match(packageSmoke, /bin target does not start with a Node shebang/);
  });

  it('documents public contribution and security privacy rules', () => {
    const contributing = fs.readFileSync('CONTRIBUTING.md', 'utf8');
    const security = fs.readFileSync('SECURITY.md', 'utf8');
    const texts = [contributing, security];
    if (isSourceCheckout()) {
      texts.push(fs.readFileSync('.github/ISSUE_TEMPLATE/bug_report.yml', 'utf8'));
    }

    for (const text of texts) {
      assert.match(text, /cookie/i);
      assert.match(text, /data\//i);
      assert.match(text, /reports\//i);
    }
    assert.match(contributing, /npm run verify/);
    assert.match(contributing, /npm run smoke:package/);
    assert.match(security, /MUSIC_LIKES_SYNC_LIVE_VALIDATE=1/);
  });

  it('documents provider setup and troubleshooting without weakening privacy rules', () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    const chineseReadme = fs.readFileSync('README.zh-CN.md', 'utf8');
    const providers = fs.readFileSync('docs/PROVIDERS.md', 'utf8');
    const stateDocs = fs.readFileSync('docs/STATE.md', 'utf8');
    const roadmap = fs.readFileSync('docs/PRODUCT_ROADMAP.md', 'utf8');

    assert.match(providers, /QQ Music/);
    assert.match(providers, /NetEase Cloud Music/);
    assert.match(providers, /MUSIC_U/);
    assert.match(providers, /dirid/);
    assert.match(providers, /MUSIC_LIKES_SYNC_LIVE_CONFIRM/);
    assert.match(providers, /MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID/);
    assert.match(providers, /creates a disposable playlist/i);
    assert.match(providers, /Recommended credential flow/);
    assert.match(providers, /data\/qq-edge-profile/);
    assert.match(providers, /Chrome DevTools Protocol/);
    assert.match(providers, /refreshes the QQ snapshot automatically/);
    assert.match(providers, /ptqrshow/);
    assert.match(providers, /fcg_user_created_diss/);
    assert.match(providers, /GET \/api\/qq\/playlists/);
    assert.match(providers, /DelSonglist/);
    assert.match(providers, /fcg_music_delbatchsong/);
    assert.match(providers, /login_qr_key/);
    assert.match(providers, /login_qr_create/);
    assert.match(providers, /login_qr_check/);
    assert.match(providers, /refreshes the NetEase snapshot after login succeeds/);
    assert.match(providers, /playlist_tracks/);
    assert.match(providers, /data\//);
    assert.match(providers, /reports\//);
    assert.match(providers, /redact/i);
    assert.match(providers, /Mid-only tracks can be added by `mid`, but removal requires a numeric QQ song id/);
    assert.match(readme, /Delete operations require a target track `id`/);
    assert.match(chineseReadme, /删除必须带目标平台主 `id`/);
    assert.match(chineseReadme, /QQ 只有 `mid`、没有可删除 `id` 的条目会被阻塞/);
    assert.match(stateDocs, /a `mid` alone is not enough for destructive deletion/);
    assert.match(roadmap, /blocks mid-only removals before provider mutation/);
    assert.match(roadmap, /Credential acquisition should prefer guided local flows/);
    assert.match(roadmap, /background cookie polling/);
    assert.match(roadmap, /One-click QQ login flow/);
    assert.match(roadmap, /QQ playlist ID diagnostics/);
    assert.match(roadmap, /In-app QQ \/ WeChat QR flow backed by Tencent's official login page/);
    assert.match(roadmap, /fresh-profile human scan/);
  });

  it('documents the ordinary-user redesign, technical decision, and implementation gates', () => {
    const prd = fs.readFileSync('docs/AI_MUSIC_AGENT_PRD.zh-CN.md', 'utf8');
    const ux = fs.readFileSync('docs/UX_FLOW_SPEC.zh-CN.md', 'utf8');
    const tech = fs.readFileSync('docs/TECH_STACK_DECISION.zh-CN.md', 'utf8');
    const readiness = fs.readFileSync('docs/IMPLEMENTATION_READINESS.zh-CN.md', 'utf8');
    const apiContract = fs.readFileSync('docs/API_CONTRACT.zh-CN.md', 'utf8');
    const policyAudit = fs.readFileSync('docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md', 'utf8');
    const roadmap = fs.readFileSync('docs/PRODUCT_ROADMAP.md', 'utf8');

    for (const label of ['概览', '连接平台', '同步方式', '同步预览', 'AI 助手', '高级设置']) {
      assert.match(ux, new RegExp(label, 'u'));
    }
    for (const phrase of [
      'Ordinary users must not need to understand cookies',
      'Additions and deletions must remain separate execution paths',
      'A missing track on one platform is not enough evidence for global deletion',
      'AI can suggest and explain; it cannot bypass preview, dry-run, or confirmation',
      'Agent tools can read evidence and draft actions',
      'The product must still work without Hermes',
    ]) {
      assert.match(readiness, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.match(ux, /snapshot \| 读取音乐库/);
    assert.match(ux, /mirror plan \| 同步预览/);
    assert.match(ux, /cookie \| 登录凭据/);
    assert.match(ux, /AI 只查看必要的歌曲信息，不会直接执行同步/);
    assert.match(tech, /React \+ Vite \+ TypeScript/);
    assert.match(tech, /Existing Node ESM backend/);
    assert.match(tech, /Built-in AI first/);
    assert.match(tech, /Agent tools second/);
    assert.match(tech, /No direct Agent write access/);
    assert.match(tech, /Keep current UI running/);
    assert.match(tech, /docs\/API_CONTRACT\.zh-CN\.md/);
    assert.match(prd, /Agent 禁止/);
    assert.match(prd, /直接新增或删除平台歌曲/);
    assert.match(prd, /直接读取或修改 cookies/);
    assert.match(prd, /MusicBrainz/);
    assert.match(prd, /AI payload 原文默认不保存/);
    assert.match(roadmap, /docs\/IMPLEMENTATION_READINESS\.zh-CN\.md/);
    assert.match(roadmap, /docs\/API_CONTRACT\.zh-CN\.md/);
    assert.match(readiness, /docs\/API_CONTRACT\.zh-CN\.md/);
    assert.match(readiness, /docs\/POLICY_CORE_DRAFT_AUDIT\.zh-CN\.md/);
    assert.match(apiContract, /not a claim that all endpoints already exist/);
    assert.match(policyAudit, /not an implementation acceptance report/);
    assert.match(readiness, /src\/sync-policy\.js` exists as a unit-tested domain implementation candidate/);
    assert.match(readiness, /covered by state validation \/ migration gates/);
    assert.match(readiness, /Confirm the five-screen ordinary-user UI structure/);
    assert.match(readiness, /Confirm React \+ Vite \+ TypeScript/);
    assert.match(readiness, /frontend architecture should stay at documentation, audit, and test-planning level/);
    assert.match(readiness, /Isolated domain, state validation, and compatibility HTTP wrappers may be added/);
  });

  it('documents sync-policy draft invariants before exposing it as product behavior', () => {
    const policyAudit = fs.readFileSync('docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md', 'utf8');

    for (const heading of [
      'Union Mode Can Propagate Unreviewed Clusters',
      'Managed Bidirectional Mode Does Not Explicitly Block Missing Baseline',
      'Confirmed Global Delete Searches All Platforms, Not Participants',
      'Read-Only Mode Uses A Non-Contract Status',
      'Summary Fields Are Not Fully Maintained',
      'Apple Write Capability Is Overstated',
      'Canonical Mirror Generated Time Is Not Fully Controlled',
    ]) {
      assert.match(policyAudit, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    for (const phrase of [
      'test/sync-policy.test.js` now imports `src/sync-policy.js`',
      'Public state validators now accept',
      'Migration checks now include those policy-driven v1 state files',
      'must not be treated as complete ordinary-user API behavior',
      'cluster.needsReview cannot create executable or resolvable additions',
      'deletion propagation cannot proceed without a valid baseline',
      'non-participating platform snapshots are ignored',
      'Read-only additions use `status: "blocked"` with `blockedReason: "read_only_policy"`',
      'Apple should not be listed as writable unless a tested write adapter exists',
      'Add validators to `src/state-schema.js`',
      'Keep `/api/mirror/*` available',
      'Do not treat `src/sync-policy.js` as complete ordinary-user API behavior before the remaining product exposure gates are resolved',
    ]) {
      assert.match(policyAudit, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('documents the ordinary-user product API contract and legacy compatibility mapping', () => {
    const apiContract = fs.readFileSync('docs/API_CONTRACT.zh-CN.md', 'utf8');

    for (const route of [
      'GET /api/app/state',
      'POST /api/platforms/read',
      'GET /api/sync/modes',
      'POST /api/sync/check',
      'GET /api/sync/preview',
      'POST /api/sync/confirm-review',
      'POST /api/sync/execute-additions',
      'POST /api/sync/confirm-deletions',
      'POST /api/sync/execute-deletions',
      'POST /api/ai/review',
      'POST /api/ai/profile',
      'POST /api/ai/tombstones/analyze',
      'POST /api/ai/similar',
      'POST /api/ai/recommend',
      'GET /api/agent/tools',
      'POST /api/agent/chat',
    ]) {
      assert.match(apiContract, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    for (const term of [
      'will_add',
      'will_keep',
      'needs_confirmation',
      'may_delete',
      'canonical_mirror',
      'union_convergence',
      'managed_bidirectional',
      'read_only_analysis',
      'confirm_global_delete',
      'current_platform_only',
    ]) {
      assert.match(apiContract, new RegExp(term));
    }

    assert.match(apiContract, /Addition execution and deletion execution are separate endpoints/);
    assert.match(apiContract, /Deletion execution requires a prior deletion confirmation record/);
    assert.match(apiContract, /Read endpoints must not trigger provider mutation/);
    assert.match(apiContract, /AI and Agent endpoints must not receive cookies/);
    assert.match(apiContract, /Agent endpoints can return drafts and explanations, not direct provider mutations/);
    assert.match(apiContract, /AI suggestions cannot create confirmed global deletions/);
    assert.match(apiContract, /QQ `mid` alone is not enough for deletion/);
    assert.match(apiContract, /Requires explicit consent before sending track evidence to an external provider/);
    assert.match(apiContract, /Forbidden tools/);
    assert.match(apiContract, /direct provider add\/delete/);
    assert.match(apiContract, /cookie read\/write/);
    assert.match(apiContract, /deletion confirmation bypass/);
    assert.match(apiContract, /raw state dump by default/);
    assert.match(apiContract, /Compatibility Mapping/);
    assert.match(apiContract, /\/api\/mirror\/plan/);
    assert.match(apiContract, /\/api\/mirror\/apply/);
    assert.match(apiContract, /\/api\/mirror\/ai\/review/);
    assert.match(apiContract, /Every step must preserve `\/api\/mirror\/\*` compatibility/);
  });

  it('documents policy v2 state and validation gates before product API exposure', () => {
    const stateDocs = fs.readFileSync('docs/STATE.md', 'utf8');
    const validationDocs = fs.readFileSync('docs/VALIDATION.md', 'utf8');

    assert.match(stateDocs, /Policy-Driven Sync State/);
    assert.match(stateDocs, /Policy-driven sync state now has validators and migration checks/);
    assert.match(stateDocs, /Ordinary-user APIs write the policy, preview, baseline, tombstone, and policy run-log files/);
    for (const file of [
      'data/sync-policy.json',
      'data/sync-baseline.json',
      'data/sync-preview.json',
      'data/sync-tombstones.json',
      'data/sync-runs.json',
      'data/ai-provider-state.json',
      'data/music-profile.json',
      'data/recommendation-shortlists.json',
      'data/agent-sessions.json',
    ]) {
      assert.match(stateDocs, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(validationDocs, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const policy of ['canonical_mirror', 'union_convergence', 'managed_bidirectional', 'read_only_analysis']) {
      assert.match(stateDocs, new RegExp(policy));
      assert.match(validationDocs, new RegExp(policy));
    }
    for (const tombstoneAction of ['confirm_global_delete', 'ignore', 'restore', 'current_platform_only']) {
      assert.match(stateDocs, new RegExp(tombstoneAction));
      assert.match(validationDocs, new RegExp(tombstoneAction));
    }
    assert.match(stateDocs, /AI raw payloads are not persisted unless debug mode is explicitly enabled/i);
    assert.match(stateDocs, /Agent-generated add\/delete actions remain drafts/);
    assert.match(stateDocs, /Product APIs must validate policy state before every write/);
    assert.match(validationDocs, /V2 Validation Gates/);
    assert.match(validationDocs, /Domain and state validation have partial current coverage/);
    assert.match(validationDocs, /Apple canonical policy summaries must match the existing mirror engine/);
    assert.match(validationDocs, /Read-only analysis must block provider mutations/);
    assert.match(validationDocs, /Agent permission tests must prove Agent tools cannot read cookies/);
    assert.match(validationDocs, /Deletion execution fails without prior confirmation/);
    assert.match(validationDocs, /AI consent is required before sending track evidence to an external provider/);
    assert.match(validationDocs, /check:privacy` must reject new `data\/debug\/`, Agent traces, AI raw payloads/);
    assert.match(validationDocs, /Target-refresh convergence evidence after sync execution/);
  });

  it('keeps QQ credential capture automated after opening the official login page', () => {
    const server = fs.readFileSync('src/server.js', 'utf8');
    const qqEdge = fs.readFileSync('src/qq-edge.js', 'utf8');
    const webApp = fs.readFileSync('web/app.js', 'utf8');
    const webHtml = fs.readFileSync('web/index.html', 'utf8');
    const reactClient = fs.readFileSync('web-app/src/api/client.ts', 'utf8');
    const reactScreen = fs.readFileSync('web-app/src/screens/ConnectPlatformsScreen.tsx', 'utf8');

    assert.match(server, /\/api\/qq\/qr\/start/);
    assert.match(server, /\/api\/qq\/qr\/check/);
    assert.match(server, /\/api\/qq\/browser\/check/);
    assert.match(server, /\/api\/qq\/playlists/);
    assert.match(server, /checkQQMusicBrowserLogin/);
    assert.match(server, /completeQQMusicQrLogin/);
    assert.match(server, /credential_verifying/);
    assert.match(server, /saveCookies\(\{ qqCookie: status\.capture\.cookie \}\)/);
    assert.match(server, /listQQPlaylists/);
    assert.match(qqEdge, /checkQQMusicBrowserLogin/);
    assert.match(qqEdge, /startQQMusicQrLogin/);
    assert.match(qqEdge, /open\.weixin\.qq\.com/);
    assert.match(qqEdge, /canvas\.toDataURL\('image\/png'\)/);
    assert.match(qqEdge, /Network\.getAllCookies/);
    assert.match(qqEdge, /cookie_ready/);
    assert.match(webHtml, /QQ 扫码登录/);
    assert.match(webHtml, /qqBrowserLoginBox/);
    assert.match(webHtml, /qqPlaylistPicker/);
    assert.match(webApp, /startQqBrowserLogin/);
    assert.match(webApp, /\/api\/qq\/browser\/check/);
    assert.match(webApp, /\/api\/qq\/playlists/);
    assert.match(webApp, /refreshQqPlaylists/);
    assert.match(webApp, /setInterval\(checkQqBrowserLogin, 1800\)/);
    assert.match(webApp, /QQ Cookie 已保存，正在拉取 QQ 快照/);
    assert.match(reactClient, /\/api\/qq\/browser\/open/);
    assert.match(reactClient, /\/api\/qq\/qr\/start/);
    assert.match(reactClient, /\/api\/qq\/qr\/check/);
    assert.match(reactClient, /\/api\/qq\/browser\/check/);
    assert.match(reactClient, /\/api\/qq\/playlists/);
    assert.match(reactClient, /\/api\/netease\/qr\/start/);
    assert.match(reactClient, /\/api\/netease\/qr\/check/);
    assert.match(reactScreen, /setQqPolling\(true\)/);
    assert.match(reactScreen, /window\.setTimeout\(poll, 1800\)/);
    assert.match(reactScreen, /refreshPlatformSnapshot\(platform\)/);
    assert.match(reactScreen, /QQ 扫码/);
    assert.match(reactScreen, /微信扫码/);
    assert.match(reactScreen, /使用本机快捷登录/);
    assert.match(reactScreen, /登录凭据只保存在这台电脑/);
    assert.doesNotMatch(reactScreen, /qqCookie|neteaseCookie|MUSIC_U|qm_keyst/);
  });

  it('captures Apple Favorite Songs through the catalog playlist API before DOM fallback', () => {
    const appleEdge = fs.readFileSync('src/apple-edge.js', 'utf8');
    const server = fs.readFileSync('src/server.js', 'utf8');
    const workflow = fs.readFileSync('src/workflow.js', 'utf8');

    assert.match(appleEdge, /pathSegments\.findLast/);
    assert.match(appleEdge, /\^pl\[\.\-\]/);
    assert.match(appleEdge, /\/v1\/catalog\/\$\{storefront\}\/playlists\/\$\{playlistId\}\/tracks/);
    assert.match(appleEdge, /\/v1\/me\/library\/playlists\/\$\{playlistId\}\/tracks/);
    assert.match(appleEdge, /method: 'musickit-api'/);
    assert.match(appleEdge, /method: 'dom-scroll'/);
    assert.match(appleEdge, /requireMusicKit/);
    assert.match(appleEdge, /Promise\.race/);
    assert.match(appleEdge, /pageHasReadyMusicKit/);
    assert.match(server, /enrichStorefronts: true/);
    assert.match(workflow, /enrichAppleSnapshotWithStorefrontAliases/);
  });

  it('keeps automatic sync additions-only, readiness-gated, and cross-process locked', () => {
    const server = fs.readFileSync('src/server.js', 'utf8');
    const workflow = fs.readFileSync('src/workflow.js', 'utf8');
    const autoSync = fs.readFileSync('src/auto-sync.js', 'utf8');
    const runLock = fs.readFileSync('src/run-lock.js', 'utf8');
    const reactScreen = fs.readFileSync('web-app/src/screens/AutoSyncScreen.tsx', 'utf8');
    const apiContract = fs.readFileSync('docs/API_CONTRACT.zh-CN.md', 'utf8');
    const stateDocs = fs.readFileSync('docs/STATE.md', 'utf8');

    assert.match(server, /GET[^\n]*\/api\/auto-sync|url\.pathname === '\/api\/auto-sync'/);
    assert.match(server, /\/api\/auto-sync\/run/);
    assert.match(server, /\/api\/ai\/additions\/review/);
    assert.match(server, /\/api\/ai\/identity\/review/);
    assert.match(server, /\/api\/sync\/identity-decision/);
    assert.match(server, /runProductAutoSync\(\{ trigger: 'scheduled' \}\)/);
    assert.match(workflow, /acquireRunLock/);
    assert.match(workflow, /deletionSignals/);
    assert.match(workflow, /enrichMetadata: true, metadataLimit: 0/);
    assert.match(workflow, /requireMusicKit: true/);
    assert.doesNotMatch(workflow.slice(workflow.indexOf('async function performProductAutoSync'), workflow.indexOf('export async function getProductLiveValidationState')), /executeProductSyncDeletions/);
    assert.match(autoSync, /AUTO_SYNC_MIN_INTERVAL_MINUTES = 15/);
    assert.match(autoSync, /assessAppleAutoSyncCapture/);
    assert.match(autoSync, /autoSyncRequiresBaseline/);
    assert.match(autoSync, /apple_capture_not_authoritative/);
    assert.match(autoSync, /apple_capture_large_drop/);
    assert.match(runLock, /fs\.open\(filePath, 'wx'\)/);
    assert.match(runLock, /DEFAULT_RUN_LOCK_HEARTBEAT_MS/);
    assert.match(runLock, /reclaimOrphanedRunLock/);
    assert.match(workflow, /reviewProductAddCandidates/);
    assert.match(workflow, /reviewProductIdentityCandidates/);
    assert.match(workflow, /applyProductIdentityDecision/);
    assert.match(workflow, /requestDeepSeekSyncReview/);
    assert.match(reactScreen, /react-auto-sync-readiness/);
    assert.match(reactScreen, /删除保持人工确认/);
    assert.match(apiContract, /There is no setting that permits scheduled deletion/);
    assert.match(stateDocs, /data\/auto-sync\.json/);
    assert.match(stateDocs, /data\/auto-sync-runs\.json/);
    assert.match(stateDocs, /data\/auto-sync\.lock/);
  });

  it('requires checksummed recovery points before destructive sync writes', () => {
    const server = fs.readFileSync('src/server.js', 'utf8');
    const workflow = fs.readFileSync('src/workflow.js', 'utf8');
    const backup = fs.readFileSync('src/sync-backup.js', 'utf8');
    const netease = fs.readFileSync('src/providers/netease.js', 'utf8');
    const reactScreen = fs.readFileSync('web-app/src/screens/SyncPreviewScreen.tsx', 'utf8');
    const stateDocs = fs.readFileSync('docs/STATE.md', 'utf8');

    assert.match(server, /\/api\/sync\/backups/);
    assert.match(server, /\/api\/sync\/backups\/restore/);
    assert.match(server, /\/api\/sync\/media/);
    assert.match(workflow, /reason: 'pre_delete'/);
    assert.match(workflow, /backupResult = await createProductSyncBackup\([\s\S]+executeProductPolicyRemoveMirrorPlan/);
    assert.match(workflow, /async function executeProductPolicyRemoveMirrorPlan[\s\S]+executeMirrorSyncPlan/);
    assert.match(workflow, /mirrorPlanExecutesRemovals/);
    assert.match(backup, /createHash\('sha256'\)/);
    assert.match(backup, /verifySyncBackup/);
    assert.match(backup, /RESTORE BACKUP/);
    assert.match(netease, /user_playlist/);
    assert.match(netease, /specialType/);
    assert.match(reactScreen, /react-deletion-safety/);
    assert.match(reactScreen, /react-preview-pagination/);
    assert.match(reactScreen, /react-version-audition/);
    assert.match(reactScreen, /audition-decision/);
    assert.match(reactScreen, /可以，保留/);
    assert.match(reactScreen, /不可以，替换/);
    assert.match(reactScreen, /不会自动播放/);
    assert.match(reactScreen, /继续加载/);
    assert.match(reactScreen, /仅补回缺失歌曲/);
    assert.match(stateDocs, /data\/sync-backups\.json/);
  });

  it('exposes repeatable release validation scripts', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.equal(pkg.scripts['check:state'], 'node ./scripts/check-state.mjs');
    assert.equal(pkg.scripts['check:ci'], 'node ./scripts/check-ci-workflow.mjs');
    assert.equal(pkg.scripts['check:privacy'], 'node ./scripts/privacy-smoke.mjs');
    assert.equal(pkg.scripts['migrate:state'], 'node ./scripts/migrate-state.mjs');
    assert.equal(pkg.scripts['smoke:http'], 'node ./scripts/http-smoke.mjs');
    assert.equal(pkg.scripts['smoke:web-app'], 'node ./scripts/web-app-smoke.mjs');
    assert.equal(pkg.scripts['smoke:ui'], 'node ./scripts/ui-smoke.mjs');
    assert.equal(pkg.scripts['smoke:agent-mcp'], 'node ./scripts/agent-mcp-smoke.mjs');
    assert.equal(pkg.scripts['smoke:docker'], 'node ./scripts/docker-smoke.mjs');
    assert.equal(pkg.scripts['smoke:package'], 'node ./scripts/package-smoke.mjs');
    assert.equal(pkg.scripts['smoke:fresh-install'], 'node ./scripts/fresh-install-smoke.mjs');
    assert.equal(pkg.scripts['fetch:docker-report'], 'node ./scripts/fetch-docker-report.mjs');
    assert.equal(pkg.scripts['validate:live'], 'node ./scripts/live-provider-validation.mjs');
    assert.equal(pkg.scripts['check:release:strict'], 'node ./scripts/release-readiness.mjs');
    assert.equal(pkg.scripts.audit, 'npm audit --omit=dev');
    for (const command of [
      'npm run check:ci',
      'npm run check:privacy',
      'npm run verify',
      'npm run migrate:state',
      'npm run smoke:package',
      'npm run smoke:fresh-install',
      'npm run validate:live',
      'npm run audit',
      'npm run smoke:http',
      'npm run smoke:web-app',
      'npm run smoke:agent-mcp',
      'npm run smoke:ui',
      'npm run smoke:docker',
    ]) {
      assert.match(pkg.scripts['check:release'], new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('keeps privacy smoke wired into CI and contributor guidance', () => {
    const contributing = fs.readFileSync('CONTRIBUTING.md', 'utf8');

    if (isSourceCheckout()) {
      const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
      assert.match(workflow, /npm run check:privacy/);
    }
    assert.match(contributing, /npm run check:privacy/);
  });

  it('checks the fresh package first-run path before release', () => {
    const checkCi = fs.readFileSync('scripts/check-ci-workflow.mjs', 'utf8');
    const freshSmoke = fs.readFileSync('scripts/fresh-install-smoke.mjs', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');
    const chineseReadme = fs.readFileSync('README.zh-CN.md', 'utf8');
    const validationDocs = fs.readFileSync('docs/VALIDATION.md', 'utf8');

    if (isSourceCheckout()) {
      const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
      assert.match(workflow, /npm run smoke:fresh-install/);
    }
    assert.match(checkCi, /npm run smoke:fresh-install/);
    assert.match(freshSmoke, /examples\/apple\.sample\.csv/);
    assert.match(freshSmoke, /mirror-decision --action keep\|separate\|clear/);
    assert.match(freshSmoke, /missing\.qq\.cookie/);
    assert.match(freshSmoke, /缺少可比较的平台快照/);
    assert.match(freshSmoke, /CLI help should not create data\//);
    assert.match(freshSmoke, /CLI check should not create data\//);
    assert.match(freshSmoke, /source-only CI workflow check should explain source checkout requirement/);
    assert.match(freshSmoke, /packaged Docker smoke should explain source checkout requirement/);
    assert.match(freshSmoke, /tarballInstallBin/);
    assert.match(freshSmoke, /tarballRuntimeRoot/);
    assert.match(freshSmoke, /tarballWeb/);
    assert.match(freshSmoke, /runInstalledPackageTests\(bin\)/);
    assert.match(freshSmoke, /tarballTests/);
    assert.match(freshSmoke, /runInstalledWebSmoke\(bin\)/);
    assert.match(freshSmoke, /node_modules\/music-likes-sync/);
    assert.match(readme, /installed package's `npm test`/);
    assert.match(chineseReadme, /已安装包内 `npm test`/);
    assert.match(validationDocs, /installed package's `npm test`/);
  });

  it('checks isolated HTTP smoke coverage for mirror and product APIs', () => {
    const httpSmoke = fs.readFileSync('scripts/http-smoke.mjs', 'utf8');
    const chineseReadme = fs.readFileSync('README.zh-CN.md', 'utf8');
    const validationDocs = fs.readFileSync('docs/VALIDATION.md', 'utf8');
    const roadmap = fs.readFileSync('docs/PRODUCT_ROADMAP.md', 'utf8');

    assert.match(httpSmoke, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), 'music-likes-sync-http-smoke-/);
    assert.match(httpSmoke, /import net from 'node:net'/);
    assert.match(httpSmoke, /await pickFreePort\(\)/);
    assert.match(httpSmoke, /server\.listen\(0, '127\.0\.0\.1'/);
    assert.match(httpSmoke, /MUSIC_LIKES_SYNC_HOME: tempRoot/);
    assert.match(httpSmoke, /seedMirrorFixtures\(tempRoot\)/);
    assert.match(httpSmoke, /qqMidOnlyTrack/);
    assert.match(httpSmoke, /midOnlyRemove/);
    assert.match(httpSmoke, /invalidRemoves/);
    assert.match(httpSmoke, /\/api\/mirror\/decisions/);
    assert.match(httpSmoke, /\/api\/mirror\/convergence/);
    assert.match(httpSmoke, /\/api\/app\/state/);
    assert.match(httpSmoke, /\/api\/sync\/modes/);
    assert.match(httpSmoke, /\/api\/sync\/check/);
    assert.match(httpSmoke, /\/api\/sync\/preview\?bucket=may_delete/);
    assert.match(httpSmoke, /\/api\/sync\/execute-additions/);
    assert.match(httpSmoke, /\/api\/sync\/confirm-deletions/);
    assert.match(httpSmoke, /\/api\/sync\/execute-deletions/);
    assert.match(httpSmoke, /delete execution should fail before confirmation/);
    assert.match(validationDocs, /isolated temporary `MUSIC_LIKES_SYNC_HOME`/);
    assert.match(validationDocs, /OS-assigned localhost port/);
    assert.match(validationDocs, /mid-only remove/);
    assert.match(validationDocs, /deletion execution fails before `POST \/api\/sync\/confirm-deletions`/);
    assert.match(chineseReadme, /QQ mid-only 删除阻塞/);
    assert.match(validationDocs, /does not write into the checkout's local `data\/` or `reports\/`/);
    assert.match(roadmap, /\/api\/mirror\/decisions/);
    assert.match(roadmap, /\/api\/sync\/check/);
    assert.match(roadmap, /deletion execution blocking before confirmation/);
    assert.match(roadmap, /mid-only removals/);
  });

  it('checks UI smoke coverage for executable delete confirmation counts', () => {
    const uiSmoke = fs.readFileSync('scripts/ui-smoke.mjs', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');

    assert.match(uiSmoke, /executableRemove/);
    assert.match(uiSmoke, /delete dialog should show executable remove count/);
    assert.match(uiSmoke, /operation\.action === 'remove' && operation\.targetTrack\?\.id/);
    assert.match(readme, /Delete operations require a target track `id`/);
  });

  it('uses the caller working directory for runtime state', () => {
    const utils = fs.readFileSync('src/utils.js', 'utf8');
    const envExample = fs.readFileSync('.env.example', 'utf8');
    const stateDocs = fs.readFileSync('docs/STATE.md', 'utf8');

    assert.match(utils, /PACKAGE_ROOT/);
    assert.match(utils, /process\.cwd\(\)/);
    assert.match(utils, /MUSIC_LIKES_SYNC_HOME/);
    assert.match(utils, /WEB_DIR = path\.join\(PACKAGE_ROOT, 'web'\)/);
    assert.match(envExample, /MUSIC_LIKES_SYNC_HOME=/);
    assert.match(stateDocs, /current working directory/);
  });

  it('keeps local machine paths out of public docs', () => {
    const privacy = fs.readFileSync('scripts/privacy-smoke.mjs', 'utf8');
    const publicDocs = [
      'README.md',
      'README.zh-CN.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/PRODUCT_ROADMAP.md',
      'docs/AI_MUSIC_AGENT_PRD.zh-CN.md',
      'docs/UX_FLOW_SPEC.zh-CN.md',
      'docs/TECH_STACK_DECISION.zh-CN.md',
      'docs/IMPLEMENTATION_READINESS.zh-CN.md',
      'docs/API_CONTRACT.zh-CN.md',
      'docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md',
      'docs/PROVIDERS.md',
      'docs/USER_GUIDE.zh-CN.md',
      'docs/STATE.md',
      'docs/VALIDATION.md',
    ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    assert.match(privacy, /Windows user profile path/);
    assert.match(privacy, /Unix user home path/);
    assert.doesNotMatch(publicDocs, /\b[A-Z]:\\Users\\/u);
    assert.doesNotMatch(publicDocs, /(?:^|[\s"'`])\/(?:Users|home)\/[^/\s"'`]+/u);
  });

  it('keeps fake repository URLs out of public release docs', () => {
    const privacy = fs.readFileSync('scripts/privacy-smoke.mjs', 'utf8');
    const publicDocs = [
      'README.md',
      'README.zh-CN.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/PRODUCT_ROADMAP.md',
      'docs/AI_MUSIC_AGENT_PRD.zh-CN.md',
      'docs/UX_FLOW_SPEC.zh-CN.md',
      'docs/TECH_STACK_DECISION.zh-CN.md',
      'docs/IMPLEMENTATION_READINESS.zh-CN.md',
      'docs/API_CONTRACT.zh-CN.md',
      'docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md',
      'docs/PROVIDERS.md',
      'docs/USER_GUIDE.zh-CN.md',
      'docs/STATE.md',
      'docs/VALIDATION.md',
    ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    assert.match(privacy, /PLACEHOLDER_TEXT_PATTERNS/);
    assert.match(privacy, /placeholder repository URL/);
    assert.doesNotMatch(publicDocs, /github\.com\/your-name\//u);
    assert.doesNotMatch(publicDocs, new RegExp(`<${'your-fork-or-release-repo-url'}>`, 'u'));
    assert.doesNotMatch(publicDocs, /<你的\s*fork\s*或发布仓库\s*URL>/u);
  });

  it('keeps the local web UI offline until a provider action is requested', () => {
    const webSurface = [
      'web/index.html',
      'web/app.js',
      'web/styles.css',
      'web-app/index.html',
      'web-app/src/app/App.tsx',
      'web-app/src/api/client.ts',
    ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    assert.doesNotMatch(webSurface, /hitokoto/u);
    assert.doesNotMatch(webSurface, /HITOKOTO_URL/u);
  });

  it('requires Docker build/run smoke in the strict release gate', () => {
    const strictGate = fs.readFileSync('scripts/release-readiness.mjs', 'utf8');
    const validationDocs = fs.readFileSync('docs/VALIDATION.md', 'utf8');
    const fetchDockerReport = fs.readFileSync('scripts/fetch-docker-report.mjs', 'utf8');
    const checkCi = fs.readFileSync('scripts/check-ci-workflow.mjs', 'utf8');
    const workflow = isSourceCheckout() ? fs.readFileSync('.github/workflows/ci.yml', 'utf8') : '';

    assert.match(strictGate, /docker-smoke\.mjs/);
    assert.match(strictGate, /--require-docker/);
    assert.match(strictGate, /payload\?\.skipped === false/);
    assert.match(strictGate, /docker-smoke\.json/);
    assert.match(strictGate, /validateDockerReport/);
    assert.match(strictGate, /MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS/);
    assert.match(strictGate, /--skip-docker-check requires/);
    assert.match(fetchDockerReport, /docker-smoke-report-node-24/);
    assert.match(fetchDockerReport, /gh/);
    assert.match(fetchDockerReport, /skipped must be false/);
    assert.match(fetchDockerReport, /runtime\.stateOk must be true/);
    assert.match(checkCi, /--require-docker --write-report/);
    assert.match(checkCi, /actions\/upload-artifact@v4/);
    assert.match(checkCi, /docker-smoke-report-node-24/);
    assert.match(checkCi, /reports\/docker-smoke\.json/);
    if (workflow) {
      assert.match(workflow, /npm run smoke:docker -- --require-docker --write-report/);
      assert.match(workflow, /actions\/upload-artifact@v4/);
      assert.match(workflow, /docker-smoke-report-node-24/);
      assert.match(workflow, /reports\/docker-smoke\.json/);
    }
    assert.match(validationDocs, /--skip-docker-check` option is test-only/);
    assert.match(validationDocs, /MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS=1/);
    assert.match(validationDocs, /npm run fetch:docker-report/);
  });

  it('does not allow Docker smoke to be skipped outside test-only strict gate calls', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-skip-guard-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = spawnSync(process.execPath, [
      './scripts/release-readiness.mjs',
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS: '',
      },
    });

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    const dockerCheck = payload.checks.find((check) => check.id === 'docker.smoke');
    assert.equal(dockerCheck.ok, false);
    assert.match(dockerCheck.message, /MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS=1/);
  });

  it('accepts a fresh Docker smoke evidence report when local Docker is unavailable', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-docker-report-'));
    const dockerReport = path.join(reportsDir, 'docker-smoke.json');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');
    fs.writeFileSync(dockerReport, JSON.stringify(fixtureDockerReport()), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--docker-report',
      dockerReport,
      '--json',
    ], {
      env: {
        DOCKER_BIN: 'missing-docker-for-test',
        PATH: '',
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const dockerCheck = payload.checks.find((check) => check.id === 'docker.smoke');
    assert.equal(dockerCheck.ok, true);
    assert.equal(dockerCheck.fromReport, true);
    assert.equal(dockerCheck.skipped, false);
    assert.match(dockerCheck.message, /evidence report is complete/);
    assert.doesNotMatch(result.stdout, /container-id|cookie|qm_keyst|MUSIC_U/);
  });

  it('rejects skipped Docker smoke reports as strict release evidence', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-docker-report-skipped-'));
    const dockerReport = path.join(reportsDir, 'docker-smoke.json');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');
    fs.writeFileSync(dockerReport, JSON.stringify({
      ...fixtureDockerReport(),
      ok: true,
      skipped: true,
    }), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--docker-report',
      dockerReport,
      '--json',
    ], {
      env: {
        DOCKER_BIN: 'missing-docker-for-test',
        PATH: '',
      },
    });

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    const dockerCheck = payload.checks.find((check) => check.id === 'docker.smoke');
    assert.equal(dockerCheck.ok, false);
    assert.match(dockerCheck.message, /skipped must be false/);
  });

  it('accepts complete strict release evidence reports', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-ready-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'release_ready');
    assert.deepEqual(payload.checks.map((check) => check.id), [
      'docker.smoke',
      'live.qq',
      'live.netease',
    ]);
    const liveChecks = payload.checks.filter((check) => check.id.startsWith('live.'));
    assert.equal(liveChecks.every((check) => check.playlistIdPresent === true), true);
    assert.equal(liveChecks.every((check) => Object.hasOwn(check, 'playlistId') === false), true);
    assert.doesNotMatch(result.stdout, /qq-playlist|netease-playlist/);
  });

  it('uses MUSIC_LIKES_SYNC_HOME reports for strict release evidence by default', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-home-'));
    const reportsDir = path.join(homeDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--skip-docker-check',
      '--json',
    ], {
      env: {
        MUSIC_LIKES_SYNC_HOME: homeDir,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(path.normalize(payload.reportsDir), path.normalize(reportsDir));
  });

  it('rejects strict release evidence reports that contain credentials', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-secret-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      cookie: 'MUSIC_U=...',
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /credential-like data/);
  });

  it('rejects strict release evidence reports without add/remove snapshot progression', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-weak-evidence-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      snapshots: {
        before: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:00:00.000Z', playlistId: 'qq-playlist', trackCount: 3 },
        afterAdd: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:01:00.000Z', playlistId: 'qq-playlist', trackCount: 3 },
        afterRemove: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:02:00.000Z', playlistId: 'qq-playlist', trackCount: 2 },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    const message = payload.checks.find((check) => check.id === 'live.qq').message;
    assert.match(message, /afterAdd\.trackCount/);
    assert.match(message, /afterRemove\.trackCount/);
  });

  it('rejects strict release evidence reports without validated-track presence proof', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-presence-evidence-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      snapshots: {
        before: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:00:00.000Z', playlistId: 'qq-playlist', trackCount: 0, containsValidatedTrack: false },
        afterAdd: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:01:00.000Z', playlistId: 'qq-playlist', trackCount: 1, containsValidatedTrack: false },
        afterRemove: { source: 'qq:fixture', fetchedAt: '2026-07-07T00:02:00.000Z', playlistId: 'qq-playlist', trackCount: 0, containsValidatedTrack: false },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /afterAdd\.containsValidatedTrack/);
  });

  it('rejects strict release evidence reports with unverified mutations', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-unverified-mutation-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      add: { requested: 1, submitted: 1, accepted: 1, added: 1, verified: false },
      remove: { requested: 1, submitted: 1, accepted: 1, removed: 1, verified: false },
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    const message = payload.checks.find((check) => check.id === 'live.qq').message;
    assert.match(message, /add mutation must be verified/);
    assert.match(message, /remove mutation must be verified/);
  });

  it('rejects strict release evidence reports with unsupported schema versions', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-schema-version-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      schemaVersion: 0,
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /schemaVersion must be 1/);
  });

  it('rejects strict release evidence reports from a different package version', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-tool-version-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      tool: { name: 'music-likes-sync', version: '0.0.0' },
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /tool\.version must be/);
  });

  it('rejects stale strict release evidence reports', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-stale-evidence-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      validatedAt: new Date(Date.now() - 15 * DAY_MS).toISOString(),
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /validatedAt must be within 14 days/);
  });

  it('rejects future-dated strict release evidence reports', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-future-evidence-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify({
      ...fixtureLiveReport('qq'),
      validatedAt: new Date(Date.now() + 10 * MINUTE_MS).toISOString(),
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'live-validation-netease.json'), JSON.stringify(fixtureLiveReport('netease')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.match(payload.checks.find((check) => check.id === 'live.qq').message, /validatedAt must not be in the future/);
  });

  it('fails strict release evidence when a target report is missing', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-release-blocked-'));
    fs.writeFileSync(path.join(reportsDir, 'live-validation-qq.json'), JSON.stringify(fixtureLiveReport('qq')), 'utf8');

    const result = runStrictReleaseReadiness([
      '--reports-dir',
      reportsDir,
      '--skip-docker-check',
      '--json',
    ]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, 'blocked');
    assert.match(payload.checks.find((check) => check.id === 'live.netease').message, /Missing/);
  });
});

function fixtureLiveReport(target) {
  const baseTime = Date.now() - 4 * MINUTE_MS;
  const timestamps = {
    before: new Date(baseTime).toISOString(),
    afterAdd: new Date(baseTime + MINUTE_MS).toISOString(),
    afterRemove: new Date(baseTime + 2 * MINUTE_MS).toISOString(),
    validatedAt: new Date(baseTime + 3 * MINUTE_MS).toISOString(),
  };

  return {
    schemaVersion: 1,
    tool: currentPackageInfo(),
    ok: true,
    verified: true,
    validatedAt: timestamps.validatedAt,
    target,
    playlistId: `${target}-playlist`,
    playlistName: `${target} disposable`,
    createdPlaylist: true,
    query: 'fixture song',
    selectedCandidateIndex: 0,
    preExistingCandidateCount: 0,
    track: {
      id: `${target}-track`,
      mid: target === 'qq' ? 'qq-mid' : null,
      title: 'Fixture Song',
      artist: 'Fixture Artist',
    },
    snapshots: {
      before: { source: `${target}:fixture`, fetchedAt: timestamps.before, playlistId: `${target}-playlist`, trackCount: 0, containsValidatedTrack: false },
      afterAdd: { source: `${target}:fixture`, fetchedAt: timestamps.afterAdd, playlistId: `${target}-playlist`, trackCount: 1, containsValidatedTrack: true },
      afterRemove: { source: `${target}:fixture`, fetchedAt: timestamps.afterRemove, playlistId: `${target}-playlist`, trackCount: 0, containsValidatedTrack: false },
    },
    add: { requested: 1, submitted: 1, accepted: 1, added: 1, verified: true },
    remove: { requested: 1, submitted: 1, accepted: 1, removed: 1, verified: true },
  };
}

function fixtureDockerReport() {
  return {
    schemaVersion: 1,
    tool: currentPackageInfo(),
    ok: true,
    skipped: false,
    validatedAt: new Date(Date.now() - 2 * MINUTE_MS).toISOString(),
    docker: 'Docker version 28.0.0, build fixture',
    image: 'music-likes-sync:smoke-fixture',
    port: 4319,
    staticChecks: {
      ok: true,
      checks: [],
    },
    build: {
      ok: true,
      stdoutTail: 'Successfully tagged music-likes-sync:smoke-fixture',
      stderrTail: '',
    },
    runtime: {
      stateOk: true,
    },
  };
}

function currentPackageInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
  };
}

function runStrictReleaseReadiness(args, options = {}) {
  return spawnSync(process.execPath, ['./scripts/release-readiness.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS: '1',
      ...(options.env || {}),
    },
  });
}
