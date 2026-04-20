// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import { createAu, createFandom } from "../engine-fandom";
import {
  getProjectForEditing,
  getWorkspaceSnapshot,
  getWriterProjectContext,
  saveAuSettingsForEditing,
  saveProjectCoreIncludes,
  saveProjectWritingStyle,
} from "../engine-project";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

class SlowMockAdapter extends MockAdapter {
  async readFile(path: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return super.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.writeFile(path, content);
  }
}

describe("engine-project commands and queries", () => {
  let adapter: SlowMockAdapter;
  let auPath: string;

  beforeEach(async () => {
    adapter = new SlowMockAdapter();
    initEngine(adapter, "/data");

    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
  });

  it("preserves both fields across concurrent project commands", async () => {
    const initialProject = await getProjectForEditing(auPath);
    const writingStyle = {
      ...initialProject.writing_style,
      custom_instructions: "Keep the tension high.",
    };
    const coreAlwaysInclude = ["timeline.md", "characters.md"];

    await Promise.all([
      saveProjectWritingStyle(auPath, writingStyle),
      saveProjectCoreIncludes(auPath, coreAlwaysInclude),
    ]);

    const project = await getProjectForEditing(auPath);
    expect(project.writing_style).toEqual(writingStyle);
    expect(project.core_always_include).toEqual(coreAlwaysInclude);
  });

  it("keeps edit query rich while writer query stays redacted", async () => {
    await saveAuSettingsForEditing(auPath, {
      chapter_length: 2800,
      writing_style: {
        perspective: "first_person",
        emotion_style: "lyrical",
        custom_instructions: "Lean into introspection.",
      },
      pinned_context: ["Team 7 mission notes"],
      core_always_include: ["mission.md"],
      llm_override: {
        enabled: true,
        mode: "api",
        model: "gpt-test",
        api_base: "https://example.com/v1",
        api_key: "super-secret-key",
        local_model_path: "",
        ollama_model: "",
        context_window: 64000,
      },
      embedding_override: {
        enabled: true,
        model: "embed-test",
        api_base: "https://embed.example.com/v1",
        api_key: "embed-secret",
      },
    });

    const project = await getProjectForEditing(auPath);
    const writerContext = await getWriterProjectContext(auPath);
    const workspace = await getWorkspaceSnapshot(auPath);

    expect(project.llm.api_key).toBe("super-secret-key");
    expect(project.embedding_lock.api_key).toBe("embed-secret");
    expect(writerContext.llm.has_api_key).toBe(true);
    expect("api_key" in writerContext.llm).toBe(false);
    expect(workspace.au_name).toBe("Canon");
    expect(workspace.pinned_count).toBe(1);
  });

  it("keeps workspace display names from project metadata", async () => {
    const fandom = await createFandom("My/Fandom");
    const au = await createAu(fandom.name, "AU/One", fandom.path);

    const workspace = await getWorkspaceSnapshot(au.path);

    expect(workspace.au_name).toBe("AU/One");
  });
});
