import { describe, expect, it } from 'vitest';
import type { Attachment } from '../../domain/types';
import {
  adjacentImagePreviewIndex,
  clampImagePreviewZoom,
  imagePreviewIndex,
  stepImagePreviewZoom,
  uniqueImagePreviewAttachments
} from './image-preview-model';

const image = (assetId: string, mimeType = 'image/png'): Attachment => ({ assetId, mimeType, fileName: `${assetId}.png`, byteSize: 1 });

describe('image preview model', () => {
  it('clamps zoom and advances in stable 25% steps', () => {
    expect(stepImagePreviewZoom(1, 1)).toBe(1.25);
    expect(stepImagePreviewZoom(1, -1)).toBe(0.75);
    expect(clampImagePreviewZoom(99)).toBe(4);
    expect(clampImagePreviewZoom(-1)).toBe(0.25);
    expect(clampImagePreviewZoom(Number.NaN)).toBe(1);
  });

  it('does not wrap previous/next navigation across sequence boundaries', () => {
    expect(adjacentImagePreviewIndex(1, 3, -1)).toBe(0);
    expect(adjacentImagePreviewIndex(1, 3, 1)).toBe(2);
    expect(adjacentImagePreviewIndex(0, 3, -1)).toBeUndefined();
    expect(adjacentImagePreviewIndex(2, 3, 1)).toBeUndefined();
  });

  it('keeps only unique image assets and locates the active asset', () => {
    const attachments = uniqueImagePreviewAttachments([image('a'), image('a'), image('pdf', 'application/pdf'), image('b')]);
    expect(attachments.map(item => item.assetId)).toEqual(['a', 'b']);
    expect(imagePreviewIndex(attachments, 'b')).toBe(1);
  });
});
