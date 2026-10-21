import type { NahidaClientError } from '@kimposoft/plugin-sdk/nahida-im';

/**
 * 撤回失败错误码 → i18n key 的纯函数（2026-08-11）。
 *
 * 接线核实结论：宿主 IM 客户端的错误映射已经把后端 `{"error":{code,message}}` 信封的精确 code 原样透传到
 * 抛给插件的 NahidaClientError.details.backendCode——本就透传，宿主零改动。
 * 但宿主同时会把 backendCode 粗粒度归类进 NahidaErrorCode 枚举，归类规则是子串匹配
 * `backendCode.includes('REVOK')`，新的撤回超窗错误码 ERR_IM_REVOKE_WINDOW_EXPIRED
 * 恰好命中这条规则，会和"消息已被撤回"共用同一个枚举桶 NAHIDA_MESSAGE_REVOKED。
 * 因此这里必须按 details.backendCode 精确码区分，不能按粗粒度 code 枚举区分。
 */
const REVOKE_WINDOW_EXPIRED_BACKEND_CODE = 'ERR_IM_REVOKE_WINDOW_EXPIRED';

/** 撤回失败提示对应的 i18n key，须与 locales/zh-CN.json、locales/en-US.json 的 key 完全一致 */
export type RevokeErrorMessageKey = 'error.revokeExpired' | 'error.revoke';

/**
 * 把 revokeMessage 抛出的 unknown 异常映射为具体提示 key。
 * 撤回超窗（ERR_IM_REVOKE_WINDOW_EXPIRED）给专属文案，其余一律沿用笼统的"撤回失败"。
 */
export function revokeErrorMessageKey(error: unknown): RevokeErrorMessageKey {
  if (!error || typeof error !== 'object') return 'error.revoke';
  const details = (error as Partial<NahidaClientError>).details;
  if (!details || typeof details !== 'object') return 'error.revoke';
  const backendCode = Reflect.get(details, 'backendCode');
  return backendCode === REVOKE_WINDOW_EXPIRED_BACKEND_CODE ? 'error.revokeExpired' : 'error.revoke';
}
