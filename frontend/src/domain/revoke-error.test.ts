import { describe, expect, it } from 'vitest';
import { revokeErrorMessageKey } from './revoke-error';

describe('revoke error mapping', () => {
  it('maps the revoke-window-expired backend code to the dedicated i18n key', () => {
    const error = {
      name: 'NahidaHostError',
      code: 'NAHIDA_MESSAGE_REVOKED', // 宿主粗粒度枚举与"已撤回"共用同一桶，须靠 backendCode 精确区分
      message: 'the backend request error',
      retryable: false,
      details: { backendCode: 'ERR_IM_REVOKE_WINDOW_EXPIRED' }
    };
    expect(revokeErrorMessageKey(error)).toBe('error.revokeExpired');
  });

  it('falls back to the generic revoke-failed key for other backend codes sharing the same enum bucket', () => {
    const error = {
      name: 'NahidaHostError',
      code: 'NAHIDA_MESSAGE_REVOKED',
      message: 'the backend request error',
      retryable: false,
      details: { backendCode: 'ERR_IM_MESSAGE_REVOKED' }
    };
    expect(revokeErrorMessageKey(error)).toBe('error.revoke');
  });

  it('falls back to the generic key when the error is missing, malformed, or has no details', () => {
    expect(revokeErrorMessageKey(undefined)).toBe('error.revoke');
    expect(revokeErrorMessageKey(null)).toBe('error.revoke');
    expect(revokeErrorMessageKey('boom')).toBe('error.revoke');
    expect(revokeErrorMessageKey(new Error('network down'))).toBe('error.revoke');
    expect(revokeErrorMessageKey({ code: 'NAHIDA_UNKNOWN' })).toBe('error.revoke');
    expect(revokeErrorMessageKey({ code: 'NAHIDA_MESSAGE_REVOKED', details: {} })).toBe('error.revoke');
  });
});
