import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = new URL('../dist/plugin.umd.js', import.meta.url);

describe('kimpo-im-next production bundle boundary', () => {
  it('builds without workflow mocks, fixtures, demo or React/Tencent runtimes', () => {
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      'build'
    ], { cwd: packageRoot, stdio: 'pipe' });

    const bundle = readFileSync(bundlePath, 'utf8');
    const forbidden = [
      { label: 'workflow mock key', pattern: /mock-workflow-key/ },
      { label: 'workflow mock title', pattern: /Mock Workflow/ },
      { label: 'workflow mock instance', pattern: /mock-instance-id/ },
      { label: 'workflow mock task', pattern: /mock-task-id/ },
      { label: 'workflow mock asset', pattern: /mock-asset-id/ },
      { label: 'fixture runtime', pattern: /\bfixtures?\b/i },
      { label: 'demo runtime', pattern: /\bdemo\b/i },
      // The English UI verb "React" is legitimate. Match runtime-specific
      // signatures instead of that business label.
      { label: 'React runtime', pattern: /(?:react-dom|react\/jsx-runtime|react\.production|__REACT_DEVTOOLS|react\.(?:element|fragment)|Symbol\.for\(["']react\.)/i },
      { label: 'Tencent runtime', pattern: /(?:TencentCloud|TUIKit|ChatEngine|@tencentcloud)/i }
    ];
    expect(forbidden.filter(rule => rule.pattern.test(bundle)).map(rule => rule.label)).toEqual([]);
  }, 30_000);
});
