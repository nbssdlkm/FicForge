// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AuLoreLayout 状态下沉回归（长期债②第二块）：
 * 25 useState → 4 hooks（data / editor / modals / actions）后锁住的行为——
 * 双列表加载（含「files 固定拉 characters」修复）、打开文件回显+别名解析、
 * 保存时别名写回 frontmatter、新建/删除的 registry 同步与回滚收尾、
 * 导入候选排除已有角色 + 成功后全量 reload、pin 缺核心限制弹引导、
 * 回收站恢复的章节/角色分流，以及切 AU 重拉。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuLoreLayout } from "../AuLoreLayout";
import { parseAliasesFromContent } from "../lore-utils";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 重型子组件与本测试无关，剪掉其 API 面；TrashPanel 换成可触发 onRestore 的桩
vi.mock("../../shared/SettingsMarkdown", () => ({
  SettingsMarkdown: ({ content }: { content: string }) => <pre data-testid="settings-md">{content}</pre>,
}));
vi.mock("../../shared/MilestoneGuide", () => ({ MilestoneGuide: () => null }));
vi.mock("../../shared/TrashPanel", () => ({
  TrashPanel: ({ onRestore }: { onRestore?: (entry: unknown) => void }) => (
    <div>
      {/* entity_name 按 deleteLore 的真实落库形态带 .md，锁住恢复时的去后缀处理 */}
      <button
        type="button"
        onClick={() =>
          onRestore?.({ trash_id: "t1", original_path: "characters/恢复角色.md", entity_name: "恢复角色.md" })
        }
      >
        restore-character
      </button>
      <button
        type="button"
        onClick={() => onRestore?.({ trash_id: "t2", original_path: "chapters/main/ch0003.md", entity_name: "第三章" })}
      >
        restore-chapter
      </button>
    </div>
  ),
}));

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getProjectForEditing: vi.fn(),
    listLoreFiles: vi.fn(),
    readLore: vi.fn(),
    saveLore: vi.fn(),
    deleteLore: vi.fn(),
    importFromFandom: vi.fn(),
    getLoreContent: vi.fn(),
    saveProjectCastRegistryCharacters: vi.fn(),
    saveProjectCoreIncludes: vi.fn(),
  };
});

import {
  getProjectForEditing,
  listLoreFiles,
  readLore,
  saveLore,
  deleteLore,
  importFromFandom,
  getLoreContent,
  saveProjectCastRegistryCharacters,
  saveProjectCoreIncludes,
} from "../../../api/engine-client";

const AU_PATH = "fandoms/f/aus/a";

const CHARACTER_CONTENT = "---\nname: 主角甲\naliases: [小甲, 甲哥]\n---\n\n# 主角甲\n\n正文一段";

const projectFixture = () => ({
  name: "测试AU",
  cast_registry: { characters: ["主角甲", "配角乙"] },
  core_always_include: ["主角甲"],
});

/** 图标按钮（Trash2 / Plus）没有可访问名，经 lucide 的 svg class 定位。 */
function clickIconButton(iconClassFragment: string) {
  const icon = document.querySelector(`svg[class*="${iconClassFragment}"]`);
  expect(icon, `icon ${iconClassFragment} not found`).toBeTruthy();
  fireEvent.click(icon!.closest("button")!);
}

async function renderLayout(auPath = AU_PATH, onChaptersChanged?: () => void) {
  const utils = render(
    <FeedbackProvider>
      <AuLoreLayout auPath={auPath} onChaptersChanged={onChaptersChanged} />
    </FeedbackProvider>,
  );
  await screen.findByText("主角甲.md");
  return utils;
}

async function openCharacterFile(name = "主角甲") {
  fireEvent.click(screen.getByText(`${name}.md`));
  await waitFor(() =>
    expect(readLore).toHaveBeenCalledWith(
      expect.objectContaining({ au_path: AU_PATH, category: "characters", filename: `${name}.md` }),
    ),
  );
  // 读取完成（预览区回显正文）
  await waitFor(() => expect(screen.getByTestId("settings-md").textContent).toContain(`# ${name}`));
}

describe("AuLoreLayout — 状态下沉回归", () => {
  beforeEach(() => {
    (getProjectForEditing as Mock).mockReset().mockResolvedValue(projectFixture());
    (listLoreFiles as Mock)
      .mockReset()
      .mockImplementation(async (params: { category: string; fandom_path?: string }) => {
        if (params.fandom_path) {
          return {
            files: [
              { name: "主角甲", filename: "主角甲.md" },
              { name: "新角色丙", filename: "新角色丙.md" },
            ],
          };
        }
        if (params.category === "worldbuilding") {
          return { files: [{ name: "魔法体系", filename: "魔法体系.md" }] };
        }
        return {
          files: [
            { name: "主角甲", filename: "主角甲.md" },
            { name: "配角乙", filename: "配角乙.md" },
          ],
        };
      });
    (readLore as Mock)
      .mockReset()
      .mockImplementation(async (params: { filename: string }) =>
        params.filename === "主角甲.md"
          ? { content: CHARACTER_CONTENT }
          : { content: `# ${params.filename.replace(/\.md$/, "")}\n\n设定内容` },
      );
    (saveLore as Mock).mockReset().mockResolvedValue(undefined);
    (deleteLore as Mock).mockReset().mockResolvedValue(undefined);
    (importFromFandom as Mock).mockReset().mockResolvedValue(undefined);
    (getLoreContent as Mock).mockReset().mockResolvedValue({ content: "# 配角乙\n\n## 核心限制\n\n不能死" });
    (saveProjectCastRegistryCharacters as Mock).mockReset().mockResolvedValue(undefined);
    (saveProjectCoreIncludes as Mock).mockReset().mockResolvedValue(undefined);
  });

  it("加载后渲染角色/世界观双列表；files 固定按 characters 分类拉取", async () => {
    await renderLayout();

    expect(screen.getByText("配角乙.md")).toBeInTheDocument();
    expect(listLoreFiles).toHaveBeenCalledWith({ au_path: AU_PATH, category: "characters" });
    expect(listLoreFiles).toHaveBeenCalledWith({ au_path: AU_PATH, category: "worldbuilding" });

    // 世界观夹默认折叠，点开后可见
    expect(screen.queryByText("魔法体系.md")).toBeNull();
    fireEvent.click(screen.getByText("世界观"));
    expect(screen.getByText("魔法体系.md")).toBeInTheDocument();
  });

  it("打开角色文件：正文回显 + frontmatter 别名解析为 chips", async () => {
    await renderLayout();
    await openCharacterFile();

    expect(screen.getByTestId("settings-md").textContent).toContain("正文一段");
    expect(screen.getByText("小甲")).toBeInTheDocument();
    expect(screen.getByText("甲哥")).toBeInTheDocument();
  });

  it("编辑 + 新增别名后保存：别名写回 frontmatter，payload 来自最新正文", async () => {
    await renderLayout();
    await openCharacterFile();

    // 切编辑态，改正文（把 frontmatter 里的别名清掉，验证保存时以 chips 状态为准写回）
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const textarea = document.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe(CHARACTER_CONTENT);
    const edited = "---\nname: 主角甲\naliases: []\n---\n\n# 主角甲\n\n改过的正文";
    fireEvent.change(textarea!, { target: { value: edited } });

    // 回车新增一个别名
    const aliasInput = screen.getByPlaceholderText("输入别名，回车添加");
    fireEvent.change(aliasInput, { target: { value: "阿甲" } });
    fireEvent.keyDown(aliasInput, { key: "Enter" });
    expect(screen.getByText("阿甲")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存设定" }));
    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    const [payload] = (saveLore as Mock).mock.calls[0];
    expect(payload.au_path).toBe(AU_PATH);
    expect(payload.filename).toBe("主角甲.md");
    // TD-021 写侧统一真 YAML（dumpFrontmatterKey 块式）后不锁字节形态——断言判据改为
    // 读侧解析读回（写读闭环才是本测试要锁的行为，序列化风格由引擎单源决定）。
    expect(parseAliasesFromContent(payload.content)).toEqual(["小甲", "甲哥", "阿甲"]);
    expect(payload.content).toContain("改过的正文");
  });

  it("新建角色：查重后落盘 + registry 同步 + 直接进入编辑态", async () => {
    await renderLayout();

    clickIconButton("lucide-plus"); // 桌面侧栏头部 + → 新建弹窗
    fireEvent.change(screen.getByPlaceholderText("角色名（如：林小雨）"), { target: { value: "新角色" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(saveLore).toHaveBeenCalledTimes(1));
    const [payload] = (saveLore as Mock).mock.calls[0];
    expect(payload.filename).toBe("新角色.md");
    expect(payload.category).toBe("characters");
    await waitFor(() =>
      expect(saveProjectCastRegistryCharacters).toHaveBeenCalledWith(AU_PATH, ["主角甲", "配角乙", "新角色"]),
    );

    // 新文件同时出现在列表与编辑器头部，编辑器带默认内容进入编辑态（textarea 可见）
    expect(await screen.findAllByText("新角色.md")).toHaveLength(2);
    const textarea = document.querySelector("textarea");
    expect(textarea?.value).toBe(payload.content);
  });

  it("删除角色：registry 与必带角色同步清理，编辑器关闭", async () => {
    await renderLayout();
    await openCharacterFile();

    clickIconButton("lucide-trash");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(deleteLore).toHaveBeenCalledWith(
        expect.objectContaining({ category: "characters", filename: "主角甲.md" }),
      ),
    );
    await waitFor(() => expect(saveProjectCastRegistryCharacters).toHaveBeenCalledWith(AU_PATH, ["配角乙"]));
    // 主角甲在必带角色里 → 一并清理
    await waitFor(() => expect(saveProjectCoreIncludes).toHaveBeenCalledWith(AU_PATH, []));

    await waitFor(() => expect(screen.queryByText("主角甲.md")).toBeNull());
    expect(screen.getByText("从左边选一个角色开始编辑。")).toBeInTheDocument();
  });

  it("导入：候选排除本 AU 已有角色，导入后同步 registry 并全量 reload", async () => {
    await renderLayout();
    (getProjectForEditing as Mock).mockClear();

    fireEvent.click(screen.getAllByTitle("从Fandom导入")[0]);
    // 主角甲已存在 → 只剩新角色丙可选
    const checkbox = await screen.findByRole("checkbox");
    expect(screen.getByText("新角色丙")).toBeInTheDocument();
    expect(screen.queryByText("主角甲")).toBeNull();

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "导入选中的角色" }));

    await waitFor(() =>
      expect(importFromFandom).toHaveBeenCalledWith(
        expect.objectContaining({
          au_path: AU_PATH,
          filenames: ["新角色丙.md"],
          source_category: "core_characters",
        }),
      ),
    );
    await waitFor(() =>
      expect(saveProjectCastRegistryCharacters).toHaveBeenCalledWith(AU_PATH, ["主角甲", "配角乙", "新角色丙"]),
    );
    // 导入成功后全量 reload（重拉 project + 双列表）
    await waitFor(() => expect(getProjectForEditing).toHaveBeenCalledWith(AU_PATH));
  });

  it("pin 角色且正文缺「核心限制」→ 持久化成功并弹引导，去编辑打开该角色", async () => {
    (getLoreContent as Mock).mockResolvedValue({ content: "# 配角乙\n\n没有核心限制段落" });
    await renderLayout();

    fireEvent.click(screen.getByTitle("设为必带"));
    await waitFor(() => expect(saveProjectCoreIncludes).toHaveBeenCalledWith(AU_PATH, ["主角甲", "配角乙"]));

    // 引导弹窗 → 去编辑 → 按 characters 分类打开该角色
    expect(await screen.findByText("建议添加「核心限制」段落")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去编辑" }));
    await waitFor(() =>
      expect(readLore).toHaveBeenCalledWith(expect.objectContaining({ category: "characters", filename: "配角乙.md" })),
    );
  });

  it("回收站恢复：角色文件插回列表，章节文件走 onChaptersChanged 通道", async () => {
    const onChaptersChanged = vi.fn();
    await renderLayout(AU_PATH, onChaptersChanged);

    fireEvent.click(screen.getByText("restore-character"));
    expect(await screen.findByText("恢复角色.md")).toBeTruthy();
    expect(onChaptersChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("restore-chapter"));
    expect(onChaptersChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("第三章.md")).toBeNull();
  });

  it("切 AU：重新拉取数据并关闭上一篇打开的文件", async () => {
    const { rerender } = await renderLayout();
    await openCharacterFile();

    (getProjectForEditing as Mock).mockResolvedValue({ ...projectFixture(), name: "另一篇" });
    rerender(
      <FeedbackProvider>
        <AuLoreLayout auPath="fandoms/f/aus/b" />
      </FeedbackProvider>,
    );

    await screen.findByText("AU：另一篇");
    expect(getProjectForEditing).toHaveBeenLastCalledWith("fandoms/f/aus/b");
    expect(listLoreFiles).toHaveBeenCalledWith({ au_path: "fandoms/f/aus/b", category: "characters" });
    expect(screen.getByText("从左边选一个角色开始编辑。")).toBeInTheDocument();
  });
});
