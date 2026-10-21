import type { InjectionKey, Ref } from 'vue';

/**
 * 窗口形态平台（2026-10-17 标题栏改版）：只分两档——
 *  · 'mac'：窗口按钮（红黄绿三灯 / 弹窗关闭）放左上，其余内容排在按钮之后；
 *  · 'other'：Windows / Linux 习惯，窗口按钮放右上。
 * 网页端与桌面端共用这套判定；插件自身不碰任何桌面壳 API，桌面壳的平台由宿主
 * 以字符串提示（如 Electron 的 process.platform：'darwin' / 'win32' / 'linux'）传入。
 */
export type ImWindowPlatform = 'mac' | 'other';

/** 由外壳 provide、弹窗头等组件 inject，保证整棵插件树用同一份平台判定。 */
export const IM_WINDOW_PLATFORM: InjectionKey<Ref<ImWindowPlatform>> = Symbol('im-window-platform');

/** 浏览器侧可读到的平台线索（抽成参数便于单测，不直接依赖全局 navigator）。 */
export interface ImPlatformNavigatorLike {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
  readonly userAgent?: string;
}

const MAC_PATTERN = /mac|darwin/i;

/**
 * 判定窗口形态平台：宿主提示优先（桌面壳给的是真实 OS 平台），没有提示时退回浏览器线索。
 * 任何线索都取不到时按 'other' 处理（保持 Windows 习惯的右上按钮，不会让按钮消失）。
 */
export function resolveImWindowPlatform(hint?: string, nav?: ImPlatformNavigatorLike): ImWindowPlatform {
  const trimmedHint = hint?.trim();
  if (trimmedHint) return MAC_PATTERN.test(trimmedHint) ? 'mac' : 'other';
  const source = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
  return MAC_PATTERN.test(source) ? 'mac' : 'other';
}

/** 运行时取当前环境 navigator（SSR / 单测无 navigator 时返回 undefined）。 */
export function currentNavigator(): ImPlatformNavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as unknown as ImPlatformNavigatorLike);
}
