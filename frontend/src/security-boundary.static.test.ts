import { readdirSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('.', import.meta.url);

function productionSources(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return productionSources(child);
    if (!['.ts', '.vue'].includes(extname(entry.name)) || entry.name.endsWith('.test.ts')) return [];
    return [child];
  });
}

describe('kimpo-im-next production security boundary', () => {
  it('imports the surface helper through the production-safe SDK subpath', () => {
    const entry = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(entry).toContain("from '@kimposoft/plugin-sdk/surface'");
    expect(entry).not.toMatch(/from ['"]@kimpo\/plugin-sdk['"]/);
  });

  it('contains no naked transports, host endpoint literals, HTML injection or code evaluation', () => {
    const forbidden = [
      { label: 'fetch', pattern: /\bfetch\s*\(/ },
      { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
      { label: 'WebSocket constructor', pattern: /new\s+WebSocket\s*\(/ },
      { label: 'IM endpoint', pattern: /\/api\/v1\/im(?:\/|\b)/ },
      { label: 'IAM endpoint', pattern: /\/iam(?:\/|\b)/ },
      { label: 'v-html', pattern: /\bv-html\b/ },
      { label: 'eval', pattern: /\beval\s*\(/ },
      { label: 'Function constructor', pattern: /new\s+Function\s*\(/ }
    ];
    const violations = productionSources(sourceRoot).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return forbidden.flatMap(rule => rule.pattern.test(source) ? [`${file.pathname}: ${rule.label}`] : []);
    });
    expect(violations).toEqual([]);
  });
});
