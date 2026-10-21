import type { NahidaImClient, NahidaJsonValue, NahidaLogger } from '@kimposoft/plugin-sdk/nahida-im';
import type { NahidaWSClient } from '@kimposoft/plugin-sdk/nahida-ws';
import type { OrgDirectoryClient } from '@kimposoft/plugin-sdk/org-directory';
import type { HostUiBridge } from '@kimposoft/plugin-sdk/ui';

/** 宿主只注入正式 SDK 能力；资产能力统一从 im.assets 获取，不重复声明 asset cap。 */
export interface ImNextHostBridge {
  im?: NahidaImClient;
  org?: OrgDirectoryClient;
  ws?: NahidaWSClient;
  logger?: NahidaLogger;
  message?: { success(text: string): void; error(text: string): void; warning(text: string): void };
  /** 宿主界面服务总线（confirm / prompt 取代原生弹框）；插件经 SDK createHostUi 访问，不直接读。 */
  ui?: HostUiBridge;
  /** 宿主导航能力；插件不得直接修改 location 以绕过 host_caps。 */
  navigate?: (route: string) => void;
  /** 宿主与常驻 IM surface 共享的通知定位/活动会话小通道。 */
  imWindowState?: { pendingConvId: string | null; activeConversationId?: string | null };
  clearPendingConvId?: () => void;
  /** 插件本地推进消息或系统通知已读后，通知宿主重拉聚合未读角标。 */
  notifyUnreadMaybeChanged?: () => void;
  locale?: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
  prepareEditRequestAgreement?: (input: {
    requestId: string;
    resource: {
      resourceKind: 'workflow_definition' | 'template_design' | 'business_record';
      appId: string;
      definitionId?: string;
      templateId?: string;
      templateVersionNo?: string;
		designerType?: string;
		pluginId?: string;
		runtimeMode?: 'production' | 'test';
		testSessionId?: string;
      recordId?: string;
    };
  }) => Promise<{ proceed: boolean; local: boolean }>;
  completeEditRequestAgreement?: (requestId: string) => Promise<void>;
  cancelEditRequestAgreement?: (requestId: string) => Promise<void>;
  /**
   * 宿主提供的「打开/安装 KimpoChat 桌面版」动作。
   *
   * 🔴 插件只负责在 rail 菜单里渲染这个入口，唤起逻辑（申请一次性配对码、拼 deep link、
   * 失败降级到下载弹窗）全部在宿主侧——插件不得自行实现，那属于宿主的分发业务。
   *
   * **未注入时插件不渲染该菜单项**：桌面壳内（壳本身就是 KimpoChat）、或宿主未启用
   * 云端分发时，宿主不注入本能力，菜单里就不该出现一个点了没反应的死入口。
   */
  openDesktopApp?: () => void;
}

export interface ImNextCapabilities {
  readonly im: NahidaImClient;
  readonly org: OrgDirectoryClient;
  readonly ws: NahidaWSClient;
}

/** host_caps 可能由 fail-closed Proxy 裁剪；所有探测都捕获 getter/Proxy 抛错。 */
export function readHostCapability<K extends keyof ImNextHostBridge>(host: ImNextHostBridge | undefined, key: K): ImNextHostBridge[K] | undefined {
  try { return host?.[key]; } catch { return undefined; }
}

export function probeCapabilities(host: ImNextHostBridge | undefined): { capabilities?: ImNextCapabilities; missing: string[] } {
  const im = readHostCapability(host, 'im');
  const org = readHostCapability(host, 'org');
  const ws = readHostCapability(host, 'ws');
  let validIm = false;
  let validOrg = false;
  let validWs = false;
  try {
    const value = im as unknown as Record<string, unknown> | undefined;
    const time = value?.time as Record<string, unknown> | undefined;
    validIm = Boolean(value?.conversations && value.messages && value.groups && value.assets && typeof time?.currentTimezone === 'function');
  } catch { validIm = false; }
  try {
    const value = org as unknown as Record<string, unknown> | undefined;
    validOrg = typeof value?.listDepartments === 'function' && typeof value.listMembers === 'function' && typeof value.searchUsers === 'function' && typeof value.me === 'function';
  } catch { validOrg = false; }
  try {
    const value = ws as unknown as Record<string, unknown> | undefined;
    validWs = typeof value?.subscribe === 'function' && typeof value.onStateChange === 'function' && typeof value.getState === 'function';
  } catch { validWs = false; }
  const missing = [!validIm && 'im', !validOrg && 'org', !validWs && 'ws'].filter((item): item is string => Boolean(item));
  return missing.length ? { missing } : { capabilities: { im: im!, org: org!, ws: ws! }, missing };
}

export function report(host: ImNextHostBridge | undefined, level: 'debug' | 'info' | 'warn' | 'error', event: string, context?: Readonly<Record<string, NahidaJsonValue>>): void {
  try {
    const logger = readHostCapability(host, 'im')?.logger ?? readHostCapability(host, 'logger');
    logger?.[level](event, context);
  } catch {
    // 日志能力不可用时不能反向打断 IM 主链路。
  }
}
