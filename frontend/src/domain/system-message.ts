import type { Message } from './types';

type Translate = (key: string) => string;

function readableParam(message: Message, key: string, fallback: string, separator: string): string {
  const value = message.systemParams?.[key];
  if (Array.isArray(value)) {
    const values = value.filter(item => typeof item === 'string' || typeof item === 'number').map(String);
    return values.length ? values.join(separator) : fallback;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function readableAnyParam(message: Message, keys: readonly string[], fallback: string, separator: string): string {
  for (const key of keys) {
    const value = readableParam(message, key, '', separator);
    if (value) return value;
  }
  return fallback;
}

function hasReadableParam(message: Message, keys: readonly string[]): boolean {
  return keys.some(key => {
    const value = message.systemParams?.[key];
    return typeof value === 'string' || typeof value === 'number' || (Array.isArray(value) && value.some(item => typeof item === 'string' || typeof item === 'number'));
  });
}

function format(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), template);
}

/** Known system codes render localized code+params; unknown codes never expose raw payloads. */
export function formatSystemMessage(message: Message, t: Translate): string {
  const param = (key: string, fallbackKey: string) => readableParam(message, key, t(fallbackKey), t('system.separator'));
  const anyParam = (keys: readonly string[], fallbackKey: string) => readableAnyParam(message, keys, t(fallbackKey), t('system.separator'));
  switch (message.systemCode) {
    case 'IM_MEMBER_JOINED': return format(t('system.memberJoined'), { operator: param('operator', 'system.someone'), targets: param('targets', 'system.members') });
    case 'IM_ORG_MEMBER_JOINED': return format(t('system.orgMemberJoined'), { targets: param('targets', 'system.members') });
    case 'IM_MEMBER_LEFT': return format(t('system.memberLeft'), { user: param('userId', 'system.someone') });
    case 'IM_MEMBER_KICKED': return format(t('system.memberKicked'), { operator: param('operator', 'system.someone'), targets: param('targets', 'system.members') });
    case 'IM_ORG_MEMBER_LEFT': return format(t('system.orgMemberLeft'), { targets: param('targets', 'system.members') });
    case 'IM_GROUP_INFO_UPDATED':
    case 'IM_GROUP_UPDATED':
    case 'GROUP_UPDATED': {
      const nameKeys = ['name', 'groupName', 'newName', 'group_name', 'new_name'];
      const name = anyParam(nameKeys, 'system.group');
      const hasName = hasReadableParam(message, nameKeys);
      return hasName
        ? format(t('system.groupRenamed'), { name })
        : format(t('system.groupUpdated'), { operator: anyParam(['operator', 'operatorId'], 'system.someone') });
    }
    case 'IM_OWNER_TRANSFERRED':
    case 'OWNER_TRANSFERRED': return format(t('system.ownerTransferred'), {
      from: anyParam(['from', 'fromUser', 'fromUserId', 'oldOwner', 'oldOwnerId'], 'system.someone'),
      to: anyParam(['to', 'toUser', 'toUserId', 'newOwner', 'newOwnerId'], 'system.someone')
    });
    case 'IM_GROUP_DISSOLVED':
    case 'GROUP_DISSOLVED': return format(t('system.groupDissolved'), { operator: anyParam(['operator', 'operatorId'], 'system.someone') });
    case 'IM_ADMIN_SET': return format(t('system.adminGranted'), { operator: param('operator', 'system.someone'), target: param('target', 'system.someone') });
    case 'IM_ADMIN_REVOKED': return format(t('system.adminRevoked'), { operator: param('operator', 'system.someone'), target: param('target', 'system.someone') });
    case 'IM_GROUP_MUTE_ALL_ENABLED': return format(t('system.muteAllEnabled'), { operator: param('operator', 'system.someone') });
    case 'IM_GROUP_MUTE_ALL_DISABLED': return format(t('system.muteAllDisabled'), { operator: param('operator', 'system.someone') });
    case 'IM_MEMBER_SEND_MUTED': return format(t('system.memberSendMuted'), { operator: param('operator', 'system.someone'), target: param('target', 'system.someone') });
    case 'IM_MEMBER_SEND_UNMUTED': return format(t('system.memberSendUnmuted'), { operator: param('operator', 'system.someone'), target: param('target', 'system.someone') });
    case 'IM_ANNOUNCEMENT_PUBLISHED': return format(t('system.announcementPublished'), { operator: param('operator', 'system.someone'), text: param('text', 'system.announcement') });
    case 'IM_ANNOUNCEMENT_CLEARED': return format(t('system.announcementCleared'), { operator: param('operator', 'system.someone') });
    default: return t('system.unknown');
  }
}
