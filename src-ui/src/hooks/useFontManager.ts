// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFontManager — 字体下载 / 卸载 / 清理 的 React 状态编排。
 *
 * 接 `getFontsService()`（单例）+ 本地 React 状态：
 * - `statuses[id]`       当前每个 manifest 字体的运行时状态
 * - `progresses[id]`     下载中字体的 loaded/total
 * - `errors[id]`         最近一次失败原因（显示给用户，可用于重试前提示）
 * - `totalSize`          已下载字体总占用字节
 *
 * 不负责：字体偏好 id 本身（见 useFontSelection）、CSS 变量注入（同上）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT_MANIFEST, FontError, getFontById } from "@ficforge/engine";
import { getFontsService } from "../api/engine-fonts";
import { warnUi } from "../utils/ui-logger";

export type RuntimeStatus = "not-installed" | "downloading" | "installed" | "error";

export interface ProgressInfo {
  loaded: number;
  /** -1 = 未知（服务端未给 Content-Length 且 manifest 未填 sizeBytes）。 */
  total: number;
}

export interface FontManagerState {
  statuses: Record<string, RuntimeStatus>;
  progresses: Record<string, ProgressInfo>;
  errors: Record<string, string>;
  totalSize: number;
  installedDownloadableIds: string[];
  download: (id: string) => Promise<void>;
  cancel: (id: string) => void;
  uninstall: (id: string) => Promise<void>;
  /**
   * 清理未使用的已下载字体 —— 任何不在 `keepIds` 集合中的 downloadable 都被删除。
   * `keepIds` 典型取值：当前选中的 ui_font_id 和 reading_font_id。
   */
  cleanUnused: (keepIds: ReadonlySet<string>) => Promise<number>;
  refresh: () => Promise<void>;
}

function formatError(err: unknown): string {
  if (err instanceof FontError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function isDownloadableId(id: string): boolean {
  const entry = getFontById(id);
  return entry?.type === "downloadable";
}

export function useFontManager(): FontManagerState {
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus>>({});
  const [progresses, setProgresses] = useState<Record<string, ProgressInfo>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [totalSize, setTotalSize] = useState<number>(0);
  const initRef = useRef(false);

  const refresh = useCallback(async () => {
    const svc = getFontsService();
    // 并行查所有 status，避免 6 次串行 I/O（Web 平台 IndexedDB 可能慢）
    const entries = await Promise.all(
      FONT_MANIFEST.map(async (entry) => {
        const s = await svc.statusOf(entry.id);
        return [entry.id, s as RuntimeStatus] as const;
      }),
    );
    const nextStatuses: Record<string, RuntimeStatus> = Object.fromEntries(entries);
    // 保留 "error" 状态：它由下载失败显式置位，storage 派生不出（statusOf 只会
    // 返回 not-installed），仅在重试 / 卸载时清除。否则后台下载 settle 触发的
    // refresh 会把失败态冲掉，用户看不到出错原因。见 TD-011。
    //
    // 作用域（有意为之）：error 是**会话级**的本组件状态，不下沉到 service 单例
    // （progress 才下沉）。若下载在 Modal 关闭期间于后台失败，重开后新组件从
    // statusOf 播种为 not-installed —— 这是诚实的：失败的字体确实没装上，用户可直接
    // 重新下载。代价仅是丢失上一次的失败原因文案，不影响可操作性。跨生命周期保留失败
    // 原因价值低、surface 大（要在 service 加 error Map + 事件），故不做。
    setStatuses((prev) => {
      const merged: Record<string, RuntimeStatus> = { ...nextStatuses };
      for (const [id, s] of Object.entries(prev)) {
        if (s === "error") merged[id] = "error";
      }
      return merged;
    });
    // totalSize 走真实 storage 层（fonts/ 目录下实际文件字节累加），
    // 比用 manifest.sizeBytes 估算更准 —— 后者是 Phase 1 占位估算值。
    try {
      const size = await svc.totalStorageSize();
      setTotalSize(size);
    } catch {
      setTotalSize(0);
    }
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    refresh().catch((e) => warnUi("useFontManager", "refresh failed", e));
  }, [refresh]);

  // 订阅 service 单例的下载事件，让进度条跨 Modal 生命周期存活（TD-011）。
  // service 是进度真相源：mount 时先用 currentProgresses() 播种当前快照（续上
  // 上一个 Modal 生命周期发起、仍在后台进行的下载），再订阅增量。settle 时清掉
  // 该 id 的进度并 refresh（让后台完成的下载把状态翻成 installed / 容量更新）。
  useEffect(() => {
    const svc = getFontsService();
    setProgresses(svc.currentProgresses());
    const unsubscribe = svc.subscribeDownloads((event) => {
      if (event.type === "progress") {
        setProgresses((prev) => ({ ...prev, [event.id]: event.progress }));
        return;
      }
      setProgresses((prev) => {
        if (!(event.id in prev)) return prev;
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
      refresh().catch((e) => warnUi("useFontManager", "refresh failed", e));
    });
    return unsubscribe;
  }, [refresh]);

  const download = useCallback(
    async (id: string) => {
      // 防抖：如果 service 侧已有该字体的 pending 下载（用户快速连点、或多组件同时触发），
      // 直接返回，不再触发第二次 install（会被并发锁抛 "network: Already downloading"，
      // 让 UI 状态短暂错跳为 "error"）。
      if (getFontsService().isDownloading(id)) return;
      setStatuses((prev) => ({ ...prev, [id]: "downloading" }));
      setErrors((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        // 进度与进度清理由 service 订阅驱动（见上方 effect），不在此处接 onProgress —
        // 这样即便下载中途关闭 Modal，重开后仍能续上同一进度。TD-011。
        await getFontsService().install(id);
        setStatuses((prev) => ({ ...prev, [id]: "installed" }));
        // 触发 totalSize 刷新（复用 refresh 的求和逻辑）
        await refresh();
      } catch (err) {
        // 用户主动取消（cancel → abort）不是错误：停回 not-installed，不显示红色错误行
        // 和「重试」按钮（那会让人误以为下载失败）。进度条已由订阅的 'settled' 事件清掉。
        if (err instanceof FontError && err.code === "aborted") {
          setStatuses((prev) => ({ ...prev, [id]: "not-installed" }));
          return;
        }
        setStatuses((prev) => ({ ...prev, [id]: "error" }));
        setErrors((prev) => ({ ...prev, [id]: formatError(err) }));
      }
    },
    [refresh],
  );

  const cancel = useCallback((id: string) => {
    getFontsService().abort(id);
    // abort 后 install 会抛 aborted 走 catch，状态由 download 自己收敛。
  }, []);

  const uninstall = useCallback(
    async (id: string) => {
      try {
        await getFontsService().uninstall(id);
        setStatuses((prev) => ({ ...prev, [id]: "not-installed" }));
        setErrors((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await refresh();
      } catch (err) {
        setErrors((prev) => ({ ...prev, [id]: formatError(err) }));
      }
    },
    [refresh],
  );

  const cleanUnused = useCallback(
    async (keepIds: ReadonlySet<string>): Promise<number> => {
      let removed = 0;
      const targets = Object.entries(statuses)
        .filter(([id, s]) => s === "installed" && isDownloadableId(id) && !keepIds.has(id))
        .map(([id]) => id);
      for (const id of targets) {
        try {
          await getFontsService().uninstall(id);
          removed++;
          setStatuses((prev) => ({ ...prev, [id]: "not-installed" }));
        } catch (err) {
          setErrors((prev) => ({ ...prev, [id]: formatError(err) }));
        }
      }
      if (removed > 0) await refresh();
      return removed;
    },
    [statuses, refresh],
  );

  const installedDownloadableIds = useMemo(
    () =>
      Object.entries(statuses)
        .filter(([id, s]) => s === "installed" && isDownloadableId(id))
        .map(([id]) => id),
    [statuses],
  );

  return {
    statuses,
    progresses,
    errors,
    totalSize,
    installedDownloadableIds,
    download,
    cancel,
    uninstall,
    cleanUnused,
    refresh,
  };
}
