import { describe, expect, it } from 'vitest';
import { buildCardDisplayModel } from './card-renderer-registry';
import { localizeEditRequestCard } from './edit-request-card';
import type { BusinessCard } from './types';

function display(card: BusinessCard, locale: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' = 'zh-CN') {
  return localizeEditRequestCard(card, buildCardDisplayModel(card, { actionSource: 'nahida-message' }), locale);
}
function card(cardType: string, rendererKey: string, data: BusinessCard['data']): BusinessCard {
  return {
    cardType, schemaVersion: 1, rendererKey, title: 'server title', summary: 'server summary', data,
    state: 'pending', actions: [{ key: 'ignore', label: 'server ignore', style: 'default' }, { key: 'agree', label: 'server agree', style: 'primary' }]
  };
}

describe('typed edit request card presentation', () => {
  it('renders each business category independently', () => {
    expect(display(card('edit_request.workflow.v1', 'edit_request.workflow', { requesterDisplayName: '陈亮', resourceName: '采购审批流程' })).summary)
      .toBe('陈亮希望编辑流程“采购审批流程”。');
    const template = display(card('edit_request.template.v1', 'edit_request.template', { requesterDisplayName: '陈亮', resourceName: '采购申请表', templateVersionNo: '1.2' }));
    expect(template.summary).toBe('陈亮希望编辑模板“采购申请表”。');
    expect(template.detailRows).toEqual([{ label: '版本', value: '1.2' }]);
    expect(display(card('edit_request.business_record.v1', 'edit_request.business_record', { requesterDisplayName: '陈亮', resourceName: '采购申请表', recordNumber: 'PO-2026-001' })).summary)
      .toBe('陈亮希望编辑编号为 PO-2026-001 的“采购申请表”。');
    expect(display(card('edit_request.business_record.v1', 'edit_request.business_record', { requesterDisplayName: '陈亮', resourceName: '采购申请表', createdAtDisplay: '2026-1-1 12:12:13' })).summary)
      .toBe('陈亮希望编辑 2026-1-1 12:12:13 创建的“采购申请表”。');
  });

  it('localizes actions and released results in all four locales', () => {
    const request = card('edit_request.workflow.v1', 'edit_request.workflow', { requesterDisplayName: 'Chen', resourceName: 'Approval' });
    expect(display(request, 'en-US').actions.map(action => action.label)).toEqual(['Ignore', 'Agree']);
    expect(display(request, 'ja-JP').summary).toContain('編集を希望しています');
    const released = card('edit_request.released.template.v1', 'edit_request.released.template', { resourceName: '采购申请表', templateVersionNo: '2.0' });
    released.actions = [];
    released.state = 'agreed';
    expect(display(released, 'zh-TW').summary).toContain('請返回後手動重試');
    expect(display(released, 'en-US').actions).toEqual([]);
  });

  it('leaves unknown card types on the safe fallback model', () => {
    const unknown = card('custom.future.v1', 'custom.future', { resourceName: 'x' });
    const model = buildCardDisplayModel(unknown, { actionSource: 'none' });
    expect(localizeEditRequestCard(unknown, model, 'zh-CN')).toBe(model);
  });
});
