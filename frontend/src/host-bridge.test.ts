import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readHostCapability, type ImNextHostBridge } from './host-bridge';

describe('IM next navigation host capability', () => {
  it('declares navigation and unread notification in the plugin manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')) as {
      capabilities?: { frontend?: { surfaces?: Array<{ type?: string; host_caps?: string[] }> } };
    };
    const panel = manifest.capabilities?.frontend?.surfaces?.find(surface => surface.type === 'im-panel');
    expect(panel?.host_caps).toContain('navigation');
    expect(panel?.host_caps).toContain('unread-notify');
  });

  it('reads the optional navigate alias through the fail-closed bridge accessor', () => {
    const navigate = vi.fn();
    const bridge: ImNextHostBridge = { navigate };
    readHostCapability(bridge, 'navigate')?.('/workflow/tasks/1');
    expect(navigate).toHaveBeenCalledWith('/workflow/tasks/1');

    const guarded = new Proxy({} as ImNextHostBridge, { get() { throw new Error('denied'); } });
    expect(readHostCapability(guarded, 'navigate')).toBeUndefined();
  });
});
