# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
import os

datas = []
binaries = []
hiddenimports = [
    'tiktoken_ext.openai_public', 'tiktoken_ext',
    'openai', 'httpx', 'httpx._transports', 'httpx._transports.default',
    'pydantic', 'uvicorn.logging',
    'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan.on', 'multipart',
    # v0.1.2: prompts 条件 import
    'core.prompts.zh', 'core.prompts.en', 'core.prompts._keys',
    # v0.1.2: fastembed 及其依赖
    'hnswlib',
]

# === collect_all 依赖 ===
for pkg in [
    'chromadb', 'chroma_hnswlib',
    'tiktoken', 'tiktoken_ext',
    'onnxruntime',
    'fastembed',          # v0.1.2: 新增
    'frontmatter', 'docx', 'yaml', 'pydantic', 'multipart',
]:
    try:
        tmp_ret = collect_all(pkg)
        datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
    except Exception:
        pass  # 部分包可能无 hook，跳过

# === tiktoken BPE 词表缓存 ===
_tiktoken_cache = os.path.join(os.environ.get('TEMP', ''), 'data-gym-cache')
if os.path.isdir(_tiktoken_cache):
    datas.append((_tiktoken_cache, 'tiktoken_cache'))

# === fastembed ONNX 模型缓存 ===
# Windows symlink 问题：huggingface_hub 缓存使用 symlink，PyInstaller COLLECT 在非管理员模式下
# 无法创建 symlink。解决：只打包 snapshots 下的实际模型文件到扁平目录。
_fastembed_cache = os.path.join(os.environ.get('TEMP', ''), 'fastembed_cache')
_fastembed_snapshot = os.path.join(
    _fastembed_cache, 'models--Qdrant--bge-small-zh-v1.5', 'snapshots'
)
if os.path.isdir(_fastembed_snapshot):
    # 找到 snapshot hash 目录（如 46fbe35fd4374a00fee7de77dfddaeb6dd6a2c59）
    for _snap_dir in os.listdir(_fastembed_snapshot):
        _snap_path = os.path.join(_fastembed_snapshot, _snap_dir)
        if os.path.isdir(_snap_path):
            # 将 snapshot 目录内容直接打到 fastembed_cache 根目录
            datas.append((_snap_path, 'fastembed_cache'))
            break


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch', 'torch.*',
        'torchvision', 'torchvision.*',
        'torchaudio', 'torchaudio.*',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='fanfic-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='fanfic-sidecar',
)
