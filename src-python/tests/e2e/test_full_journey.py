"""端到端 API 真实调用测试。

启动 FastAPI 后，用 httpx 直接打真实 HTTP 请求，模拟完整用户旅程。
用法：cd src-python && PYTHONPATH=. python3 tests/e2e/test_full_journey.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time

import httpx

PORT = int(os.environ.get("TEST_PORT", "54284"))
BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = "/tmp/test_fanfic_e2e"
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

client = httpx.Client(base_url=BASE, timeout=30)

passed = 0
failed = 0
bugs: list[str] = []


def ok(label: str, detail: str = "") -> None:
    global passed
    passed += 1
    print(f"  \u2705 {label}" + (f"  ({detail})" if detail else ""))


def fail(label: str, detail: str) -> None:
    global failed
    failed += 1
    bugs.append(f"{label}: {detail}")
    print(f"  \u274c {label}: {detail}")


def section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


# =====================================================================
# 清理上一次测试残留
# =====================================================================
if os.path.exists(DATA_DIR):
    shutil.rmtree(DATA_DIR)


# =====================================================================
# 旅程 1：基础端点 — 从零开始
# =====================================================================
section("旅程 1：基础端点")

# 1.1 健康检查
r = client.get("/health")
if r.status_code == 200:
    ok("1.1 健康检查")
else:
    fail("1.1 健康检查", f"status={r.status_code}")

# 1.2 列出 fandoms（空目录）
r = client.get("/api/v1/fandoms", params={"data_dir": DATA_DIR})
if r.status_code == 200:
    ok("1.2 列出 fandoms", f"{r.json()}")
else:
    fail("1.2 列出 fandoms", f"status={r.status_code} {r.text}")

# 1.3 创建 fandom
r = client.post("/api/v1/fandoms", json={"name": "赛博朋克", "data_dir": DATA_DIR})
if r.status_code in [200, 201]:
    fandom_info = r.json()
    ok("1.3 创建 fandom", f"path={fandom_info.get('path')}")
else:
    fail("1.3 创建 fandom", f"status={r.status_code} {r.text}")
    fandom_info = {}

# 1.4 创建 AU
fandom_path = fandom_info.get("path", f"{DATA_DIR}/fandoms/赛博朋克")
r = client.post(
    "/api/v1/fandoms/赛博朋克/aus",
    json={"name": "霓虹雨夜", "fandom_path": fandom_path},
)
if r.status_code in [200, 201]:
    au_info = r.json()
    au_path = au_info.get("path", "")
    ok("1.4 创建 AU", f"au_path={au_path}")
else:
    fail("1.4 创建 AU", f"status={r.status_code} {r.text}")
    au_path = f"{fandom_path}/霓虹雨夜"

# 1.5 读取 state
r = client.get("/api/v1/state", params={"au_path": au_path})
if r.status_code == 200:
    ok("1.5 读取 state", f"current_chapter={r.json().get('current_chapter')}")
else:
    fail("1.5 读取 state", f"status={r.status_code} {r.text}")

# 1.6 读取 project
r = client.get("/api/v1/project", params={"au_path": au_path})
if r.status_code == 200:
    ok("1.6 读取 project", f"name={r.json().get('name')}")
else:
    fail("1.6 读取 project", f"status={r.status_code} {r.text}")

# 1.7 读取 settings
r = client.get("/api/v1/settings")
if r.status_code == 200:
    ok("1.7 读取 settings")
else:
    fail("1.7 读取 settings", f"status={r.status_code} {r.text}")

# 1.8 列出章节（应该为空）
r = client.get("/api/v1/chapters", params={"au_path": au_path})
if r.status_code == 200 and isinstance(r.json(), list):
    ok("1.8 列出章节", f"count={len(r.json())}")
else:
    fail("1.8 列出章节", f"status={r.status_code} {r.text}")

# 1.9 列出 facts（应该为空）
r = client.get("/api/v1/facts", params={"au_path": au_path})
if r.status_code == 200:
    ok("1.9 列出 facts", f"count={len(r.json())}")
else:
    fail("1.9 列出 facts", f"status={r.status_code} {r.text}")

# 1.10 列出 drafts（需要 chapter_num，应该为空）
r = client.get("/api/v1/drafts", params={"au_path": au_path, "chapter_num": 1})
if r.status_code == 200:
    ok("1.10 列出 drafts", f"count={len(r.json())}")
else:
    fail("1.10 列出 drafts", f"status={r.status_code} {r.text}")


# =====================================================================
# 旅程 2：配置模型
# =====================================================================
section("旅程 2：配置模型 & 写作风格")

# 2.1 更新 settings — 配置 DeepSeek API
settings_update: dict = {
    "default_llm": {
        "mode": "api",
        "model": "deepseek-chat",
        "api_base": "https://api.deepseek.com",
        "api_key": DEEPSEEK_KEY,
        "context_window": 65536,
    },
    "model_params": {
        "deepseek-chat": {
            "temperature": 0.85,
            "top_p": 0.92,
        }
    },
}
r = client.put("/api/v1/settings", json=settings_update)
if r.status_code == 200:
    ok("2.1 更新 settings (DeepSeek)")
else:
    fail("2.1 更新 settings", f"status={r.status_code} {r.text}")

# 2.2 更新 project — 写作风格 + 章节长度
project_update: dict = {
    "chapter_length": 800,
    "writing_style": {
        "perspective": "third_person",
        "pov_character": "",
        "emotion_style": "implicit",
        "custom_instructions": "赛博朋克风格，注重氛围描写。",
    },
    "cast_registry": {
        "from_core": [],
        "au_specific": ["凌风", "苏晓"],
        "oc": [],
    },
    "llm": {
        "mode": "api",
        "model": "deepseek-chat",
        "api_base": "https://api.deepseek.com",
        "api_key": DEEPSEEK_KEY,
        "context_window": 65536,
    },
}
r = client.put("/api/v1/project", params={"au_path": au_path}, json=project_update)
if r.status_code == 200:
    ok("2.2 更新 project (写作风格 + LLM)")
else:
    fail("2.2 更新 project", f"status={r.status_code} {r.text}")

# 2.3 验证 project 已更新
r = client.get("/api/v1/project", params={"au_path": au_path})
if r.status_code == 200:
    proj = r.json()
    if proj.get("chapter_length") == 800:
        ok("2.3 验证 project 更新", f"chapter_length={proj['chapter_length']}")
    else:
        fail("2.3 验证 project 更新", f"chapter_length={proj.get('chapter_length')}, expected 800")
else:
    fail("2.3 验证 project 更新", f"status={r.status_code} {r.text}")


# =====================================================================
# 旅程 3：导入已有章节
# =====================================================================
section("旅程 3：导入已有章节")

test_novel = """第一章 霓虹之下

雨水顺着酒吧的霓虹招牌滴落。在这座没有白昼的城市里，空气总是弥漫着机油与合成香精的混合气味。

凌风坐在角落的卡座里，机械义眼闪烁着微弱的蓝光。他已经在这里等了两个小时。面前的合成威士忌早就凉透了，冰块化成一汪清水。

门推开了。一个穿着黑色风衣的女人走进来，雨水从她的衣摆滴落，在地板上留下一串水渍。苏晓。他认出了她，尽管距离上次见面已经过了三年。

第二章 重逢

三天后，他们在同一家酒吧再次相遇。这一次，苏晓先开了口。

"你还记得我吗？"她的声音很轻，几乎被吧台的音乐淹没。

凌风放下手中的酒杯，抬起头。机械义眼的蓝光在昏暗的灯光下格外明显。"记得。你是苏晓。三年前，在东区的实验室。"

她在他对面坐下，从风衣口袋里掏出一个小小的数据芯片。"我需要你的帮助。"

第三章 真相

一切都在那个雨夜揭晓。凌风不是普通人，苏晓也不是。

数据芯片里存储着一段被篡改的记忆。那是关于东区实验室的真相——他们都曾是实验对象，被植入了虚假的身份认同。凌风的机械义眼不是意外受伤的结果，而是实验的一部分。

"你愿意知道真相吗？"苏晓问。

凌风沉默了很久。最后，他点了点头。
"""

with tempfile.NamedTemporaryFile(
    mode="w", suffix=".txt", delete=False, encoding="utf-8"
) as f:
    f.write(test_novel)
    test_file = f.name

# 3.1 上传预览
with open(test_file, "rb") as f:
    r = client.post(
        "/api/v1/import/upload",
        files={"file": ("赛博朋克小说.txt", f, "text/plain")},
    )
if r.status_code == 200:
    preview = r.json()
    ok(
        "3.1 导入预览",
        f"{preview['total_chapters']} 章, 方法={preview['split_method']}",
    )
else:
    fail("3.1 导入预览", f"status={r.status_code} {r.text}")
    preview = {"chapters": [], "split_method": "title", "total_chapters": 0}

# 3.2 确认导入 — 需要用完整内容，preview 只有 100 字
# 重新切分获取完整内容
from core.services.import_pipeline import split_into_chapters, get_split_method

full_chapters = split_into_chapters(test_novel)
confirm_chapters = [
    {"chapter_num": ch["chapter_num"], "title": ch["title"], "content": ch["content"]}
    for ch in full_chapters
]

r = client.post(
    "/api/v1/import/confirm",
    json={
        "au_path": au_path,
        "chapters": confirm_chapters,
        "split_method": preview.get("split_method", "title"),
    },
)
if r.status_code == 200:
    import_result = r.json()
    ok(
        "3.2 确认导入",
        f"total={import_result['total_chapters']}, chars={import_result.get('characters_found')}",
    )
else:
    fail("3.2 确认导入", f"status={r.status_code} {r.text}")

# 3.3 验证章节已写入
r = client.get("/api/v1/chapters", params={"au_path": au_path})
if r.status_code == 200:
    chapters = r.json()
    if len(chapters) >= 3:
        ok("3.3 验证章节列表", f"{len(chapters)} 章")
    else:
        fail("3.3 验证章节列表", f"expected >=3, got {len(chapters)}")
else:
    fail("3.3 验证章节列表", f"status={r.status_code} {r.text}")

# 3.4 验证 state 已初始化
r = client.get("/api/v1/state", params={"au_path": au_path})
if r.status_code == 200:
    state = r.json()
    if state.get("current_chapter", 0) >= 4:
        ok("3.4 State 初始化", f"current_chapter={state['current_chapter']}")
    else:
        fail(
            "3.4 State 初始化",
            f"current_chapter={state.get('current_chapter')}, expected >=4",
        )
else:
    fail("3.4 State 初始化", f"status={r.status_code} {r.text}")

# 3.5 读取第 1 章内容
r = client.get("/api/v1/chapters/1/content", params={"au_path": au_path})
if r.status_code == 200:
    ch1 = r.json()
    content = ch1.get("content", "")
    if "凌风" in content or "霓虹" in content:
        ok("3.5 第 1 章内容", f"{len(content)} 字符")
    else:
        fail("3.5 第 1 章内容", f"content 不包含预期文字: {content[:80]}")
else:
    fail("3.5 第 1 章内容", f"status={r.status_code} {r.text}")

# 3.6 读取第 3 章详情
r = client.get("/api/v1/chapters/3", params={"au_path": au_path})
if r.status_code == 200:
    ch3 = r.json()
    if ch3.get("provenance") == "imported":
        ok("3.6 第 3 章 provenance", "imported")
    else:
        fail("3.6 第 3 章 provenance", f"got {ch3.get('provenance')}")
else:
    fail("3.6 第 3 章详情", f"status={r.status_code} {r.text}")

os.unlink(test_file)


# =====================================================================
# 旅程 4：Facts 管理
# =====================================================================
section("旅程 4：Facts 管理")

# 4.1 添加 fact
r = client.post(
    "/api/v1/facts",
    json={
        "au_path": au_path,
        "chapter_num": 1,
        "fact_data": {
            "content_raw": "凌风有机械义眼，闪烁蓝光",
            "content_clean": "凌风左眼为机械义眼，闪烁蓝光",
            "characters": ["凌风"],
            "type": "character_detail",
            "narrative_weight": "high",
            "status": "active",
            "timeline": "当前",
        },
    },
)
if r.status_code in [200, 201]:
    fact_id = r.json().get("fact_id", "")
    ok("4.1 添加 fact", f"fact_id={fact_id}")
else:
    fail("4.1 添加 fact", f"status={r.status_code} {r.text}")
    fact_id = ""

# 4.2 添加第二个 fact
r = client.post(
    "/api/v1/facts",
    json={
        "au_path": au_path,
        "chapter_num": 2,
        "fact_data": {
            "content_raw": "苏晓带来了一个数据芯片",
            "content_clean": "苏晓持有一枚数据芯片，内含被篡改的记忆",
            "characters": ["苏晓"],
            "type": "plot_event",
            "narrative_weight": "high",
            "status": "active",
            "timeline": "当前",
        },
    },
)
if r.status_code in [200, 201]:
    fact_id_2 = r.json().get("fact_id", "")
    ok("4.2 添加第二个 fact", f"fact_id={fact_id_2}")
else:
    fail("4.2 添加第二个 fact", f"status={r.status_code} {r.text}")
    fact_id_2 = ""

# 4.3 列出 facts
r = client.get("/api/v1/facts", params={"au_path": au_path})
if r.status_code == 200:
    facts = r.json()
    if len(facts) >= 2:
        ok("4.3 列出 facts", f"{len(facts)} 条")
    else:
        fail("4.3 列出 facts", f"expected >=2, got {len(facts)}")
else:
    fail("4.3 列出 facts", f"status={r.status_code} {r.text}")

# 4.4 修改 fact 状态
if fact_id:
    r = client.patch(
        f"/api/v1/facts/{fact_id}/status",
        json={"au_path": au_path, "new_status": "unresolved", "chapter_num": 2},
    )
    if r.status_code == 200:
        ok("4.4 修改 fact 状态", f"→ UNRESOLVED")
    else:
        fail("4.4 修改 fact 状态", f"status={r.status_code} {r.text}")

# 4.5 编辑 fact
if fact_id:
    r = client.put(
        f"/api/v1/facts/{fact_id}",
        json={
            "au_path": au_path,
            "updated_fields": {
                "content_clean": "凌风左眼为机械义眼，闪烁蓝光，是实验的产物",
            },
        },
    )
    if r.status_code == 200:
        ok("4.5 编辑 fact", f"revision={r.json().get('revision')}")
    else:
        fail("4.5 编辑 fact", f"status={r.status_code} {r.text}")

# 4.6 设置 chapter_focus
if fact_id:
    r = client.put(
        "/api/v1/state/chapter-focus",
        json={"au_path": au_path, "focus_ids": [fact_id]},
    )
    if r.status_code == 200:
        ok("4.6 设置 chapter_focus", f"{r.json()}")
    else:
        fail("4.6 设置 chapter_focus", f"status={r.status_code} {r.text}")


# =====================================================================
# 旅程 5：导出
# =====================================================================
section("旅程 5：导出")

# 5.1 导出全部 txt
r = client.get("/api/v1/export", params={"au_path": au_path, "format": "txt"})
if r.status_code == 200 and len(r.text) > 50:
    has_no_frontmatter = "---" not in r.text[:20] and "chapter_id" not in r.text
    ok(
        "5.1 导出 txt",
        f"{len(r.text)} 字符, 无 frontmatter={has_no_frontmatter}",
    )
    if not has_no_frontmatter:
        fail("5.1 导出 txt (frontmatter)", "导出内容含 frontmatter YAML")
else:
    fail("5.1 导出 txt", f"status={r.status_code} len={len(r.text)}")

# 5.2 导出 md (1-2 章)
r = client.get(
    "/api/v1/export",
    params={"au_path": au_path, "start": 1, "end": 2, "format": "md"},
)
if r.status_code == 200:
    if "##" in r.text:
        ok("5.2 导出 md (1-2 章)", f"{len(r.text)} 字符, 含 ## 标题")
    else:
        fail("5.2 导出 md", "缺少 ## 标题标记")
else:
    fail("5.2 导出 md", f"status={r.status_code} {r.text}")

# 5.3 导出无标题
r = client.get(
    "/api/v1/export",
    params={
        "au_path": au_path,
        "format": "txt",
        "include_title": False,
        "include_chapter_num": False,
    },
)
if r.status_code == 200:
    if "第1章" not in r.text and "第2章" not in r.text:
        ok("5.3 导出 txt (无标题)", f"{len(r.text)} 字符")
    else:
        fail("5.3 导出 txt (无标题)", "仍包含章节标题")
else:
    fail("5.3 导出 txt (无标题)", f"status={r.status_code} {r.text}")


# =====================================================================
# 旅程 6：SSE 生成（真实 DeepSeek 调用）
# =====================================================================
section("旅程 6：SSE 生成")

if not DEEPSEEK_KEY:
    print("  ⚠️  DEEPSEEK_API_KEY 未设置，跳过生成测试")
else:
    # 6.1 生成第 4 章
    current_ch = state.get("current_chapter", 4)
    try:
        with client.stream(
            "POST",
            "/api/v1/generate/stream",
            json={
                "au_path": au_path,
                "chapter_num": current_ch,
                "user_input": "继续写第四章，凌风决定接受苏晓的帮助，一起去找东区实验室的真相。",
                "input_type": "instruction",
            },
            timeout=60,
        ) as resp:
            events: list[dict] = []
            draft_content = ""
            for line in resp.iter_lines():
                if not line.strip():
                    continue
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        ev = json.loads(data_str)
                        events.append(ev)
                        if ev.get("event") == "token":
                            draft_content += ev.get("data", {}).get("text", "")
                        elif ev.get("event") == "done":
                            draft_content = ev.get("data", {}).get("full_text", draft_content)
                    except json.JSONDecodeError:
                        pass

            if draft_content and len(draft_content) > 20:
                ok("6.1 SSE 生成第 4 章", f"{len(draft_content)} 字符, {len(events)} events")
            elif events:
                last_ev = events[-1] if events else {}
                if last_ev.get("event") == "error":
                    fail("6.1 SSE 生成", f"error: {last_ev.get('data', {}).get('message', '')}")
                else:
                    ok("6.1 SSE 生成（有事件流）", f"{len(events)} events, content={len(draft_content)} 字符")
            else:
                fail("6.1 SSE 生成", f"无事件流, status={resp.status_code}")
    except Exception as exc:
        fail("6.1 SSE 生成", f"exception: {exc}")

    # 6.2 列出 drafts
    r = client.get("/api/v1/drafts", params={"au_path": au_path, "chapter_num": current_ch})
    if r.status_code == 200:
        drafts = r.json()
        ok("6.2 列出 drafts", f"{len(drafts)} 个草稿")
    else:
        fail("6.2 列出 drafts", f"status={r.status_code} {r.text}")

    # 6.3 再次生成（第二个版本）
    try:
        with client.stream(
            "POST",
            "/api/v1/generate/stream",
            json={
                "au_path": au_path,
                "chapter_num": current_ch,
                "user_input": "换个角度，从苏晓的视角来写这一章。",
                "input_type": "instruction",
            },
            timeout=60,
        ) as resp:
            events2: list[dict] = []
            draft2 = ""
            for line in resp.iter_lines():
                if not line.strip():
                    continue
                if line.startswith("data: "):
                    try:
                        ev = json.loads(line[6:])
                        events2.append(ev)
                        if ev.get("event") == "token":
                            draft2 += ev.get("data", {}).get("text", "")
                        elif ev.get("event") == "done":
                            draft2 = ev.get("data", {}).get("full_text", draft2)
                    except json.JSONDecodeError:
                        pass
            if draft2 and len(draft2) > 20:
                ok("6.3 第二次生成", f"{len(draft2)} 字符")
            elif events2:
                ok("6.3 第二次生成（有事件流）", f"{len(events2)} events")
            else:
                fail("6.3 第二次生成", "无输出")
    except Exception as exc:
        fail("6.3 第二次生成", f"exception: {exc}")

    # 6.4 验证有 2 个 drafts
    r = client.get("/api/v1/drafts", params={"au_path": au_path, "chapter_num": current_ch})
    if r.status_code == 200:
        drafts = r.json()
        if len(drafts) >= 2:
            ok("6.4 验证 2 个 drafts", f"{len(drafts)} 个")
            draft_id = drafts[0].get("filename", "")
        else:
            fail("6.4 验证 2 个 drafts", f"got {len(drafts)}")
            draft_id = ""
    else:
        fail("6.4 验证 drafts", f"status={r.status_code} {r.text}")
        draft_id = ""

    # 6.5 确认第一个版本
    if draft_id:
        r = client.post(
            "/api/v1/chapters/confirm",
            json={
                "au_path": au_path,
                "chapter_num": current_ch,
                "draft_id": draft_id,
                "generated_with": None,
            },
        )
        if r.status_code == 200:
            ok("6.5 确认第 4 章", f"{r.json()}")
        else:
            fail("6.5 确认第 4 章", f"status={r.status_code} {r.text}")

    # 6.6 验证 state.current_chapter 推进
    r = client.get("/api/v1/state", params={"au_path": au_path})
    if r.status_code == 200:
        new_state = r.json()
        if new_state.get("current_chapter", 0) >= 5:
            ok("6.6 State 推进", f"current_chapter={new_state['current_chapter']}")
        else:
            fail(
                "6.6 State 推进",
                f"current_chapter={new_state.get('current_chapter')}, expected >=5",
            )

    # 6.7 导出验证（现在应该有 4 章）
    r = client.get("/api/v1/export", params={"au_path": au_path, "format": "txt"})
    if r.status_code == 200:
        ok("6.7 导出 4 章", f"{len(r.text)} 字符")
    else:
        fail("6.7 导出 4 章", f"status={r.status_code} {r.text}")


# =====================================================================
# 旅程 7：边界测试
# =====================================================================
section("旅程 7：边界测试")

# 7.1 重复创建同名 fandom
r = client.post("/api/v1/fandoms", json={"name": "赛博朋克", "data_dir": DATA_DIR})
if r.status_code in [200, 201, 409]:
    ok("7.1 重复创建 fandom", f"status={r.status_code}")
else:
    fail("7.1 重复创建 fandom", f"unexpected status={r.status_code} {r.text}")

# 7.2 导入到已有章节的 AU → 应返回 409
with tempfile.NamedTemporaryFile(
    mode="w", suffix=".txt", delete=False, encoding="utf-8"
) as f:
    f.write("新的第一章\n\n这是新内容。")
    tmp2 = f.name

r = client.post(
    "/api/v1/import/confirm",
    json={
        "au_path": au_path,
        "chapters": [{"chapter_num": 1, "title": "新的第一章", "content": "这是新内容。"}],
        "split_method": "auto_3000",
    },
)
if r.status_code == 409:
    ok("7.2 重复导入 → 409", f"{r.json().get('error_code')}")
elif r.status_code == 200:
    fail("7.2 重复导入", "应该返回 409 但返回了 200，数据可能被覆盖")
else:
    fail("7.2 重复导入", f"status={r.status_code} {r.text}")
os.unlink(tmp2)

# 7.3 导出范围超出实际章节数
r = client.get(
    "/api/v1/export",
    params={"au_path": au_path, "start": 100, "end": 200, "format": "txt"},
)
if r.status_code == 200 and len(r.text.strip()) == 0:
    ok("7.3 导出超出范围 → 空", f"len={len(r.text)}")
elif r.status_code == 200:
    ok("7.3 导出超出范围", f"status=200, len={len(r.text)}")
else:
    fail("7.3 导出超出范围", f"status={r.status_code} {r.text}")

# 7.4 不存在的 fact_id → PUT 应返回错误
r = client.put(
    "/api/v1/facts/nonexistent_id_xyz",
    json={"au_path": au_path, "updated_fields": {"content_clean": "test"}},
)
if r.status_code in [404, 400, 500]:
    ok("7.4 不存在的 fact PUT", f"status={r.status_code}")
else:
    fail("7.4 不存在的 fact PUT", f"unexpected status={r.status_code}")

# 7.5 不存在的 fact_id → PATCH 应返回错误
r = client.patch(
    "/api/v1/facts/nonexistent_id_xyz/status",
    json={"au_path": au_path, "new_status": "active", "chapter_num": 1},
)
if r.status_code in [404, 400, 500]:
    ok("7.5 不存在的 fact PATCH", f"status={r.status_code}")
else:
    fail("7.5 不存在的 fact PATCH", f"unexpected status={r.status_code}")

# 7.6 空 AU 的 chapters/state/facts
empty_au = f"{DATA_DIR}/fandoms/赛博朋克/空AU"
os.makedirs(empty_au, exist_ok=True)
r = client.get("/api/v1/chapters", params={"au_path": empty_au})
if r.status_code == 200 and r.json() == []:
    ok("7.6 空 AU 列出章节 → []")
else:
    fail("7.6 空 AU 章节", f"status={r.status_code} {r.text}")

# 7.7 不支持的导出格式
r = client.get(
    "/api/v1/export",
    params={"au_path": au_path, "format": "docx"},
)
if r.status_code == 400:
    ok("7.7 不支持的导出格式 → 400")
else:
    fail("7.7 不支持格式", f"status={r.status_code}")

# 7.8 上传不支持的文件类型
with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
    f.write(b"fake pdf")
    tmp_pdf = f.name
with open(tmp_pdf, "rb") as f:
    r = client.post(
        "/api/v1/import/upload",
        files={"file": ("test.pdf", f, "application/pdf")},
    )
if r.status_code == 400:
    ok("7.8 上传 .pdf → 400")
else:
    fail("7.8 上传 .pdf", f"status={r.status_code} {r.text}")
os.unlink(tmp_pdf)

# 7.9 导入空章节列表 → 400
r = client.post(
    "/api/v1/import/confirm",
    json={"au_path": f"{DATA_DIR}/fandoms/赛博朋克/新AU_empty", "chapters": []},
)
if r.status_code == 400:
    ok("7.9 导入空列表 → 400")
else:
    fail("7.9 导入空列表", f"status={r.status_code} {r.text}")


# =====================================================================
# 结果汇总
# =====================================================================
section("测试结果汇总")
total = passed + failed
print(f"\n  总计: {total} 项")
print(f"  通过: {passed} ✅")
print(f"  失败: {failed} ❌")

if bugs:
    print(f"\n  发现的 bug ({len(bugs)} 个):")
    for i, b in enumerate(bugs, 1):
        print(f"    {i}. {b}")

print()
sys.exit(0 if failed == 0 else 1)
