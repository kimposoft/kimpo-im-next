import type { Attachment } from '../../domain/types';

export const IMAGE_PREVIEW_MIN_ZOOM = 0.25;
export const IMAGE_PREVIEW_MAX_ZOOM = 4;
export const IMAGE_PREVIEW_ZOOM_STEP = 0.25;

export function clampImagePreviewZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(IMAGE_PREVIEW_MAX_ZOOM, Math.max(IMAGE_PREVIEW_MIN_ZOOM, value));
}

export function stepImagePreviewZoom(value: number, direction: -1 | 1): number {
  return clampImagePreviewZoom(value + direction * IMAGE_PREVIEW_ZOOM_STEP);
}

export function imagePreviewIndex(attachments: readonly Attachment[], assetId: string): number {
  return attachments.findIndex(attachment => attachment.assetId === assetId);
}

export function adjacentImagePreviewIndex(index: number, total: number, direction: -1 | 1): number | undefined {
  const next = index + direction;
  return next >= 0 && next < total ? next : undefined;
}

export function uniqueImagePreviewAttachments(attachments: readonly Attachment[]): Attachment[] {
  const seen = new Set<string>();
  return attachments.filter(attachment => {
    if (!attachment.mimeType.startsWith('image/') || seen.has(attachment.assetId)) return false;
    seen.add(attachment.assetId);
    return true;
  });
}
