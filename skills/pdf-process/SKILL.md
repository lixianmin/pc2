---
name: pdf-process
description: 当用户提到 PDF 文件、要求处理 PDF、或需要从 PDF 提取内容时激活此技能
evolvable: true
allowed-tools: Bash(mineru*) Bash(python3*) Bash(marker_single*) Bash(mkdir*) Bash(test*) Bash(which*) Bash(cp*) Bash(pip*) Bash(uv*)
---

# PDF Processing Skill

## 前置检查

1. 如果用户未提供文件路径，用 ask_user 询问 PDF 路径
2. 检查 mineru 是否可用:
   ```
   test -x /tmp/mineru-env/bin/mineru
   ```
   如果不可用，安装到独立 venv:
   ```
   mkdir -p /tmp/mineru-env 2>/dev/null; uv venv /tmp/mineru-env 2>/dev/null; source /tmp/mineru-env/bin/activate && uv pip install "mineru[all]"
   ```
   安装后验证: `test -x /tmp/mineru-env/bin/mineru`

## 处理单个 PDF（主方案: MinerU）

给定 PDF 路径 `<input>`（`stem` = 去掉扩展名的文件名）:

1. 创建输出目录: `mkdir -p /tmp/pc2-pdf`
2. 执行转换（timeout 设为 300000 即 5 分钟）:
   ```
   source /tmp/mineru-env/bin/activate && mineru -p <input> -o /tmp/pc2-pdf
   ```
3. 输出文件路径规则: `/tmp/pc2-pdf/{stem}/hybrid_auto/{stem}.md`
4. 用 file_read 读取 .md 文件
5. 向用户呈现内容 / 回答问题

**注意**: file_write 只能写 workspace 内路径。如果用户要求把 .md 写到 PDF 旁边（通常在 workspace 外），用 bash tool 的 `cp` 命令:
```
cp /tmp/pc2-pdf/{stem}/hybrid_auto/{stem}.md <PDF所在目录>/
```

## Fallback（pdfplumber，轻量方案）

如果 MinerU 安装失败或多次超时，用 pdfplumber 作为 fallback:

1. 确保 pdfplumber 可用: `source /tmp/mineru-env/bin/activate && python3 -c "import pdfplumber"`
2. 如果不可用: `source /tmp/mineru-env/bin/activate && uv pip install pdfplumber`
3. 写 Python 脚本提取文本并保存为 .md

## 入库到 LMD（可选）

用户要求"入库"或"记住"时:
1. 提取关键信息（事实、结论、关系）
2. 用 memory_search 检查是否已有相似内容
3. 用 addMemory 写入 LMD（type: fact 或 episode）

## 错误处理

| 错误 | 处理 |
|------|------|
| mineru 未安装 | 自动安装到 /tmp/mineru-env |
| 安装失败 | 尝试 pdfplumber fallback |
| 找不到输出 .md | 检查 /tmp/pc2-pdf/ 下的子目录结构 |
| 文件不存在 | 报错，提示用户检查路径 |
| 未提供文件路径 | 用 ask_user 询问 |
