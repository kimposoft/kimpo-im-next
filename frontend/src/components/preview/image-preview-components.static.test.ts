import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toolbar = readFileSync(new URL('./ImImagePreviewToolbar.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('image preview integration', () => {
  it('exposes labelled paging and zoom controls only through the image branch', () => {
    expect(toolbar).toContain('role="toolbar"');
    expect(toolbar).toContain(':label="previousLabel"');
    expect(toolbar).toContain(':label="zoomInLabel"');
    expect(panel).toContain('v-if="previewAssetIsImage"');
    expect(panel).toContain("descriptor.kind === 'image'");
  });

  it('keeps preview URLs on the existing AssetClient descriptor path', () => {
    expect(panel).toContain(':src="c.preview.value.descriptor.url"');
    expect(panel).toContain('await c.openAttachment(attachment)');
    expect(panel).not.toContain('fetch(');
  });

  it('supports modal keyboard navigation without changing non-image renderers', () => {
    expect(panel).toContain("event.key === 'ArrowLeft'");
    expect(panel).toContain("event.key === 'ArrowRight'");
    expect(panel).toContain("event.key === '+'");
    expect(panel).toContain("descriptor.kind === 'video'");
    expect(panel).toContain("descriptor.kind === 'pdf'");
    expect(panel).toContain('.preview-image-scroll { width:100%;height:100%;overflow:auto');
    expect(panel).toContain('watch(() => c.preview.value.status');
  });
});
