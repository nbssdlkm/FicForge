// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 跨平台 KV 存储 hook。
 * 替代直接调用 localStorage，在 iOS Safari 隐私模式和 Capacitor 环境下安全工作。
 */

import { useState, useEffect, useCallback } from "react";
import { getEngine } from "../api/engine-client";

/**
 * 使用平台适配器的 KV 存储读写字符串值。
 * mount 时异步加载初始值，写入时同步更新 state 并异步持久化。
 */
export function useKV(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    let cancelled = false;
    getEngine().adapter.kvGet(key).then((stored) => {
      if (!cancelled && stored !== null) {
        setValue(stored);
      }
    }).catch(() => { /* ignore read failures */ });
    return () => { cancelled = true; };
  }, [key]);

  const set = useCallback((v: string) => {
    setValue(v);
    getEngine().adapter.kvSet(key, v).catch(() => { /* ignore write failures */ });
  }, [key]);

  return [value, set];
}
