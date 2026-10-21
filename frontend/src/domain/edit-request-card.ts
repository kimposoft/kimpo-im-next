import type { CardDisplayModel } from './card-renderer-registry';
import type { BusinessCard } from './types';

export type EditRequestCardLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
type EditRequestCategory = 'workflow' | 'template' | 'record';

const requestCardCategories: Readonly<Record<string, EditRequestCategory>> = {
  'edit_request.workflow.v1': 'workflow',
  'edit_request.template.v1': 'template',
  'edit_request.business_record.v1': 'record'
};
const releasedCardCategories: Readonly<Record<string, EditRequestCategory>> = {
  'edit_request.released.workflow.v1': 'workflow',
  'edit_request.released.template.v1': 'template',
  'edit_request.released.business_record.v1': 'record'
};

export function localizeEditRequestCard(card: Readonly<BusinessCard>, model: CardDisplayModel, locale: EditRequestCardLocale): CardDisplayModel {
  const cardType = card.cardType ?? '';
  const released = releasedCardCategories[cardType];
  const category = released ?? requestCardCategories[cardType];
  if (!category) return model;
  const data = card.data as Record<string, unknown>;
  const requester = String(data.requesterDisplayName ?? '').trim() || ({
    'zh-CN': '其他用户', 'zh-TW': '其他使用者', 'en-US': 'Another user', 'ja-JP': '他のユーザー'
  } as const)[locale];
  const resourceName = String(data.resourceName ?? '').trim();
  const quoted = `“${resourceName}”`;
  const recordNumber = String(data.recordNumber ?? '').trim();
  const createdAt = String(data.createdAtDisplay ?? '').trim();
  let title = model.title;
  let summary = model.summary;

  if (released) {
    const resource = {
      'zh-CN': { workflow: '流程', template: '模板', record: '单据' },
      'zh-TW': { workflow: '流程', template: '範本', record: '單據' },
      'en-US': { workflow: 'workflow', template: 'template', record: 'record' },
      'ja-JP': { workflow: 'フロー', template: 'テンプレート', record: '伝票' }
    }[locale][category];
    title = ({
      'zh-CN': '编辑申请已同意', 'zh-TW': '編輯申請已同意',
      'en-US': 'Edit request accepted', 'ja-JP': '編集申請が承認されました'
    } as const)[locale];
    summary = ({
      'zh-CN': `对方已同意并释放${resource}${quoted}，请返回后手动重试。`,
      'zh-TW': `對方已同意並釋放${resource}${quoted}，請返回後手動重試。`,
      'en-US': `The editor agreed and released ${resource} ${quoted}. Return to it and retry manually.`,
      'ja-JP': `相手が同意し、${resource}${quoted}を解放しました。戻って手動で再試行してください。`
    } as const)[locale];
  } else if (category === 'workflow') {
    title = ({ 'zh-CN': '流程编辑申请', 'zh-TW': '流程編輯申請', 'en-US': 'Workflow edit request', 'ja-JP': 'フロー編集申請' } as const)[locale];
    summary = ({
      'zh-CN': `${requester}希望编辑流程${quoted}。`, 'zh-TW': `${requester}希望編輯流程${quoted}。`,
      'en-US': `${requester} would like to edit workflow ${quoted}.`, 'ja-JP': `${requester}さんがフロー${quoted}の編集を希望しています。`
    } as const)[locale];
  } else if (category === 'template') {
    title = ({ 'zh-CN': '模板编辑申请', 'zh-TW': '範本編輯申請', 'en-US': 'Template edit request', 'ja-JP': 'テンプレート編集申請' } as const)[locale];
    summary = ({
      'zh-CN': `${requester}希望编辑模板${quoted}。`, 'zh-TW': `${requester}希望編輯範本${quoted}。`,
      'en-US': `${requester} would like to edit template ${quoted}.`, 'ja-JP': `${requester}さんがテンプレート${quoted}の編集を希望しています。`
    } as const)[locale];
  } else {
    title = ({ 'zh-CN': '单据编辑申请', 'zh-TW': '單據編輯申請', 'en-US': 'Record edit request', 'ja-JP': '伝票編集申請' } as const)[locale];
    summary = recordNumber
      ? ({
          'zh-CN': `${requester}希望编辑编号为 ${recordNumber} 的${quoted}。`, 'zh-TW': `${requester}希望編輯編號為 ${recordNumber} 的${quoted}。`,
          'en-US': `${requester} would like to edit ${quoted}, record number ${recordNumber}.`, 'ja-JP': `${requester}さんが番号 ${recordNumber} の${quoted}を編集したいと考えています。`
        } as const)[locale]
      : ({
          'zh-CN': `${requester}希望编辑 ${createdAt} 创建的${quoted}。`, 'zh-TW': `${requester}希望編輯於 ${createdAt} 建立的${quoted}。`,
          'en-US': `${requester} would like to edit ${quoted}, created at ${createdAt}.`, 'ja-JP': `${requester}さんが ${createdAt} に作成された${quoted}を編集したいと考えています。`
        } as const)[locale];
  }

  const version = String(data.templateVersionNo ?? '').trim();
  const detailRows = category === 'template' && version
    ? [{ label: ({ 'zh-CN': '版本', 'zh-TW': '版本', 'en-US': 'Version', 'ja-JP': 'バージョン' } as const)[locale], value: version }]
    : model.detailRows;
  const labels = {
    'zh-CN': { ignore: '忽略', agree: '同意' }, 'zh-TW': { ignore: '忽略', agree: '同意' },
    'en-US': { ignore: 'Ignore', agree: 'Agree' }, 'ja-JP': { ignore: '無視', agree: '同意' }
  }[locale];
  return {
    ...model, title, summary, detailRows,
    actions: model.actions.map(action => ({ ...action, label: action.key === 'ignore' ? labels.ignore : action.key === 'agree' ? labels.agree : action.label }))
  };
}
