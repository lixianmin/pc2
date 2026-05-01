---
name: pdf-process
description: 当用户提到 PDF 文件、要求处理 PDF、或需要从 PDF 提取内容时激活此技能
evolvable: true
allowed-tools: Bash(python3*) Bash(mineru*) Bash(marker_single*) Bash(mkdir*) Bash(which*) Bash(pip*) Bash(uv*)
---

# PDF Processing Skill

## 前置检查

1. 如果用户未提供文件路径，用 ask_user 询问 PDF 路径
2. 检查 pdfplumber 是否可用:
   ```
   python3 -c "import pdfplumber; print('ok')"
   ```
   如果不可用，安装:
   ```
   pip install pdfplumber
   ```

## 处理单个 PDF（主方案: pdfplumber）

给定 PDF 路径 `<input>`（`stem` = 去掉扩展名的文件名）:

1. 写一个 Python 脚本到 `/tmp/pc2-pdf/convert.py`，内容如下（将 INPUT 替换为实际路径，OUTPUT 替换为输出路径）:
   ```python
   import pdfplumber, sys, os
   input_pdf = 'INPUT'
   output_md = os.path.join(os.path.dirname(input_pdf), os.path.splitext(os.path.basename(input_pdf))[0] + '.md')
   try:
       pdf = pdfplumber.open(input_pdf)
       all_text = []
       for i, page in enumerate(pdf.pages):
           text = page.extract_text()
           if text:
               all_text.append(text)
       pdf.close()
       with open(output_md, 'w', encoding='utf-8') as f:
           f.write('\n\n'.join(all_text))
       print(f'OK: {len(pdf.pages)} pages -> {output_md}')
   except Exception as e:
       print(f'Error: {e}', file=sys.stderr)
       sys.exit(1)
   ```
2. 执行: `python3 /tmp/pc2-pdf/convert.py`
3. 用 file_read 读取输出的 .md 文件
4. 向用户呈现内容 / 回答问题

## 高级方案（MinerU，适合扫描件/复杂排版）

如果 pdfplumber 提取效果不好（乱码、丢失内容），或用户明确要求使用 MinerU:

1. 检查 mineru: `which mineru`
2. 如果未安装: `uv venv /tmp/mineru-env && source /tmp/mineru-env/bin/activate && uv pip install "mineru[all]"`
3. 执行: `source /tmp/mineru-env/bin/activate && mineru -p <input> -o /tmp/pc2-pdf/{stem}`
4. 找到输出的 .md 文件并读取

## 入库到 LMD（可选）

用户要求"入库"或"记住"时:
1. 提取关键信息（事实、结论、关系）
2. 用 memory_search 检查是否已有相似内容
3. 用 addMemory 写入 LMD（type: fact 或 episode）

## 错误处理

| 错误 | 处理 |
|------|------|
| pdfplumber 未安装 | 自动 pip install pdfplumber |
| 提取内容为空或乱码 | 尝试 MinerU 方案 |
| MinerU 安装失败 | 告知用户手动安装 |
| 未提供文件路径 | 用 ask_user 询问 |
| 文件不存在 | 报错，提示用户检查路径 |
