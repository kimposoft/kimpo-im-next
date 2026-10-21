import { describe, expect, it } from 'vitest';
import { resolveImWindowPlatform } from './window-platform';

describe('resolveImWindowPlatform', () => {
  it('prefers the host hint (Electron process.platform)', () => {
    expect(resolveImWindowPlatform('darwin', { platform: 'Win32' })).toBe('mac');
    expect(resolveImWindowPlatform('win32', { platform: 'MacIntel' })).toBe('other');
    expect(resolveImWindowPlatform('linux')).toBe('other');
  });

  it('falls back to browser hints in order: userAgentData, platform, userAgent', () => {
    expect(resolveImWindowPlatform(undefined, { userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(resolveImWindowPlatform('', { platform: 'MacIntel' })).toBe('mac');
    expect(resolveImWindowPlatform(undefined, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('mac');
    expect(resolveImWindowPlatform(undefined, { userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('other');
  });

  it('defaults to other when nothing is known', () => {
    expect(resolveImWindowPlatform()).toBe('other');
    expect(resolveImWindowPlatform(undefined, {})).toBe('other');
  });
});
