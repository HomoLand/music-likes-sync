import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { loadLocalEnv } from '../src/env.js';

describe('local env loader', () => {
  it('loads .env values without overriding explicit environment variables', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-env-'));
    const filePath = path.join(dir, '.env');
    fs.writeFileSync(filePath, [
      '# comment',
      'LOCAL_TEST_API_KEY=local-key',
      'DEEPSEEK_MODEL="deepseek-v4-pro"',
      'EXISTING=value-from-file',
      'INVALID KEY=ignored',
      '',
    ].join('\n'), 'utf8');
    const env = { EXISTING: 'explicit' };

    const result = loadLocalEnv(filePath, env);

    assert.equal(result.loaded, true);
    assert.equal(env.LOCAL_TEST_API_KEY, 'local-key');
    assert.equal(env.DEEPSEEK_MODEL, 'deepseek-v4-pro');
    assert.equal(env.EXISTING, 'explicit');
    assert.equal(env['INVALID KEY'], undefined);
  });
});
