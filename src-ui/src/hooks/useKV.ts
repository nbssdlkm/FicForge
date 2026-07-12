// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 跨平台 KV 存储 hook。
 * 替代直接调用 localStorage，在 iOS Safari 隐私模式和 Capacitor 环境下安全工作。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { isEngineReady, getEngine } from "../api/engine-client";

/**
 * 使用平台适配器的 KV 存储读写字符串值。
 * mount 时异步加载初始值，写入时同步更新 state 并异步持久化。
 * 引擎初始化前安全降级为仅使用默认值。
 *
 * L21（审计第二轮）：
 * - 初始异步 kvGet resolve 时若用户已经先一步 set（异步加载慢于用户操作），不覆盖用户刚写的值。
 * - key 变更时重置 value 为 defaultValue 并对新 key 重新加载（否则会残留旧 key 的值）。
 */
export function useKV(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(defaultValue);
  // 本地是否已发生 set（针对当前 key）。异步初始加载 resolve 时据此判断是否让位给用户写入。
  const localSetRef = useRef(false);

  useEffect(() => {
    // key 变更：重置为默认值并重新加载新 key（清掉上一个 key 的残留 + 允许新 key 的初始加载覆盖）。
    setValue(defaultValue);
    localSetRef.current = false;
    if (!isEngineReady()) return;
    let cancelled = false;
    getEngine()
      .adapter.kvGet(key)
      .then((stored) => {
        // 用户已在加载完成前写过值 → 不用磁盘旧值覆盖用户刚写的（stale 异步回滚）。
        if (!cancelled && !localSetRef.current && stored !== null) {
          setValue(stored);
        }
      })
      .catch(() => {
        /* ignore read failures */
      });
    return () => {
      cancelled = true;
    };
    // defaultValue 有意不入依赖：调用方常传字面量，每次渲染新引用会触发无谓重载/重置。
    // key 才是加载键；defaultValue 仅作首屏兜底，变更极罕见。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (v: string) => {
      localSetRef.current = true;
      setValue(v);
      if (!isEngineReady()) return;
      getEngine()
        .adapter.kvSet(key, v)
        .catch(() => {
          /* ignore write failures */
        });
    },
    [key],
  );

  return [value, set];
}
