// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFontSelection 双层存储测试（盲审长期债③：312 行 localStorage + engine
 * settings 双写此前零测试；字体偏好曾因 dictToAppConfig 漏接字段丢过持久化，
 * 这里锁死「本地即时 + 引擎异步」两层的读写对称性）。
 *
 * 重点：
 * - engine 同步失败静默降级（localStorage 兜底）；persist 失败必须 warnUi 可见；
 * - 同一事件链连调两个 setter 的 stale closure 防护（第二次 persist 不得丢第一次改动）；
 * - Phase 4 → Phase 7 的 legacy 单字段 localStorage 一次性迁移。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFontsConfig, resolveFontStack } from "@ficforge/engine";
import { listFontOptions, useFontSelection } from "../useFontSelection";
import { getFontPreferences, saveFontPreferences } from "../../api/engine-client";
import { warnUi } from "../../utils/ui-logger";

vi.mock("../../api/engine-client", () => ({
  getFontPreferences: vi.fn(),
  saveFontPreferences: vi.fn(),
}));

vi.mock("../../utils/ui-logger", () => ({
  warnUi: vi.fn(),
}));

const DEFAULTS = createFontsConfig();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getFontPreferences).mockResolvedValue(DEFAULTS);
  vi.mocked(saveFontPreferences).mockResolvedValue(undefined as never);
});

describe("useFontSelection · 初始态与 engine 同步", () => {
  it("localStorage 空：4 档取 engine createFontsConfig 默认（单一真相源）", () => {
    const { result } = renderHook(() => useFontSelection());
    expect(result.current.uiLatinFontId).toBe(DEFAULTS.ui_latin_font_id);
    expect(result.current.uiCjkFontId).toBe(DEFAULTS.ui_cjk_font_id);
    expect(result.current.readingLatinFontId).toBe(DEFAULTS.reading_latin_font_id);
    expect(result.current.readingCjkFontId).toBe(DEFAULTS.reading_cjk_font_id);
  });

  it("localStorage 已有值：优先于默认（启动即时层）", () => {
    localStorage.setItem("ficforge_font_reading_cjk", "noto-serif-sc");
    const { result } = renderHook(() => useFontSelection());
    expect(result.current.readingCjkFontId).toBe("noto-serif-sc");
  });

  it("engine settings 与本地不同：state + localStorage + CSS 变量三处跟进", async () => {
    vi.mocked(getFontPreferences).mockResolvedValue({
      ...DEFAULTS,
      reading_latin_font_id: "literata",
    });
    const { result } = renderHook(() => useFontSelection());

    await waitFor(() => expect(result.current.readingLatinFontId).toBe("literata"));
    expect(localStorage.getItem("ficforge_font_reading_latin")).toBe("literata");
    expect(document.documentElement.style.getPropertyValue("--font-reading"))
      .toBe(resolveFontStack("literata", DEFAULTS.reading_cjk_font_id, "reading"));
  });

  it("engine settings 读取失败：静默保留 localStorage 值（不炸不弹错）", async () => {
    localStorage.setItem("ficforge_font_ui_latin", "lora");
    vi.mocked(getFontPreferences).mockRejectedValue(new Error("engine not ready"));
    const { result } = renderHook(() => useFontSelection());

    await act(async () => {});
    expect(result.current.uiLatinFontId).toBe("lora");
    expect(warnUi).not.toHaveBeenCalled();
  });
});

describe("useFontSelection · 选择与持久化", () => {
  it("selectReadingLatinFont：state + localStorage + CSS 即时更新，engine 收完整 4 字段快照", async () => {
    const { result } = renderHook(() => useFontSelection());

    act(() => result.current.selectReadingLatinFont("merriweather"));

    expect(result.current.readingLatinFontId).toBe("merriweather");
    expect(localStorage.getItem("ficforge_font_reading_latin")).toBe("merriweather");
    expect(document.documentElement.style.getPropertyValue("--font-reading"))
      .toBe(resolveFontStack("merriweather", DEFAULTS.reading_cjk_font_id, "reading"));
    await waitFor(() => expect(saveFontPreferences).toHaveBeenCalledWith({
      ui_latin_font_id: DEFAULTS.ui_latin_font_id,
      ui_cjk_font_id: DEFAULTS.ui_cjk_font_id,
      reading_latin_font_id: "merriweather",
      reading_cjk_font_id: DEFAULTS.reading_cjk_font_id,
    }));
  });

  it("同一事件链连调两个 setter：第二次 persist 快照必须带上第一次改动（stale closure 防护）", async () => {
    const { result } = renderHook(() => useFontSelection());

    act(() => {
      result.current.selectUiLatinFont("literata");
      result.current.selectUiCjkFont("noto-sans-sc");
    });

    await waitFor(() => expect(saveFontPreferences).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveFontPreferences).mock.calls[1][0]).toMatchObject({
      ui_latin_font_id: "literata",
      ui_cjk_font_id: "noto-sans-sc",
    });
  });

  it("engine persist 失败：本地已生效（用户无感知），但 warnUi 留下 debug 痕迹", async () => {
    vi.mocked(saveFontPreferences).mockRejectedValue(new Error("EPERM"));
    const { result } = renderHook(() => useFontSelection());

    act(() => result.current.selectUiCjkFont("ma-shan-zheng"));

    expect(result.current.uiCjkFontId).toBe("ma-shan-zheng");
    expect(localStorage.getItem("ficforge_font_ui_cjk")).toBe("ma-shan-zheng");
    await waitFor(() => expect(warnUi).toHaveBeenCalledWith(
      "useFontSelection",
      "engine settings persist failed",
      expect.objectContaining({ message: "EPERM" }),
    ));
  });
});

describe("legacy localStorage 一次性迁移（Phase 4 单字段 → Phase 7 四字段）", () => {
  it("按 scriptSlotOf 分派到对应新 key，迁移后删旧 key；新 key 已有值不覆盖", async () => {
    vi.resetModules();
    localStorage.clear();
    // cjk id → ui_cjk 槽位；latin id → reading_latin 槽位
    localStorage.setItem("ficforge_font_ui", "lxgw-wenkai-screen");
    localStorage.setItem("ficforge_font_reading", "source-serif-4");
    // reading_latin 新 key 已有用户值 → legacy 不得覆盖
    localStorage.setItem("ficforge_font_reading_latin", "lora");

    await import("../useFontSelection");

    expect(localStorage.getItem("ficforge_font_ui_cjk")).toBe("lxgw-wenkai-screen");
    expect(localStorage.getItem("ficforge_font_reading_latin")).toBe("lora");
    expect(localStorage.getItem("ficforge_font_ui")).toBeNull();
    expect(localStorage.getItem("ficforge_font_reading")).toBeNull();
  });
});

describe("listFontOptions", () => {
  it("system 恒在首位；按 script 过滤内置字体", () => {
    const latin = listFontOptions("latin");
    expect(latin[0].id).toBe("system");
    expect(latin.map((o) => o.id)).toContain("source-serif-4");
    expect(latin.map((o) => o.id)).not.toContain("lxgw-wenkai-screen");

    const cjk = listFontOptions("cjk");
    expect(cjk.map((o) => o.id)).toContain("lxgw-wenkai-screen");
    expect(cjk.map((o) => o.id)).not.toContain("source-serif-4");
  });

  it("已下载的 downloadable 进列表且不重复；跨 script 的已下载不进", () => {
    const cjk = listFontOptions("cjk", ["noto-serif-sc", "literata"]);
    expect(cjk.map((o) => o.id)).toContain("noto-serif-sc");
    // literata 是 latin downloadable，不进 cjk 列表
    expect(cjk.map((o) => o.id)).not.toContain("literata");
    // 未下载的 downloadable 不进
    expect(cjk.map((o) => o.id)).not.toContain("ma-shan-zheng");
  });

  it("alwaysInclude：当前选中 id 强制保留（select value 必须有匹配 option）；未知 id 给回退标签", () => {
    const options = listFontOptions("latin", [], ["lxgw-wenkai-screen", "ghost-font"]);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("lxgw-wenkai-screen");
    expect(ids).toContain("ghost-font");
    const ghost = options.find((o) => o.id === "ghost-font");
    expect(ghost?.label.zh).toContain("未知字体");
    // 去重：system 不因 alwaysInclude 出现两次
    const withSystem = listFontOptions("latin", [], ["system"]);
    expect(withSystem.filter((o) => o.id === "system")).toHaveLength(1);
  });
});
