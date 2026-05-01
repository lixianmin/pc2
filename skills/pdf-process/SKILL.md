---
name: pdf-process
description: 当用户提到 PDF 文件、要求处理 PDF、或需要从 PDF 提取内容时激活此技能
evolvable: true
allowed-tools: Bash(mineru*) Bash(marker_single*) Bash(mkdir*) Bash(which*) Bash(pip*)
---

# PDF Processing Skill

## 前置检查

1. 运行 `which mineru` 检查 MinerU 是否已安装
2. 如果未安装，自动执行安装:
   ```
   pip install "mineru[all]"
   ```
   安装完成后再次运行 `which mineru` 验证。如果仍然失败，告知用户手动安装并停止。
3. 如果用户未提供文件路径，用 ask_user 询问 PDF 路径

## 处理单个 PDF

给定 PDF 路径 `<input>`（`stem` = 去掉扩展名的文件名）:

1. 创建输出目录: `mkdir -p /tmp/pc2-pdf/{stem}`
2. 执行转换:
   ```
   mineru -p <input> -o /tmp/pc2-pdf/{stem}
   ```
   - 如果 mineru 失败，尝试 fallback:
     ```
     marker_single <input> /tmp/pc2-pdf/{stem}
     ```
3. 找到输出 Markdown 文件（搜索 /tmp/pc2-pdf/{stem} 下的 .md 文件）
4. 用 file_read 读取 Markdown 内容
5. 向用户呈现内容 / 回答问题

## 入库到 LMD（可选）

用户要求"入库"或"记住"时：
1. 提取关键信息（事实、结论、关系）
2. 用 memory_search 检查是否已有相似内容
3. 用 addMemory 写入 LMD（type: fact 或 episode）

## 错误处理

| 错误 | 处理 |
|------|------|
| mineru 未安装 | 自动执行 `pip install "mineru[all]"`，验证后继续 |
| 安装后仍找不到 mineru | 告知用户手动安装并停止 |
| 转换失败（mineru） | 尝试 marker_single fallback |
| marker_single 也失败 | 报错，建议用户检查文件是否加密/损坏 |
| 找不到输出 .md | 检查其他子目录，报告实际输出结构 |
| 未提供文件路径 | 用 ask_user 询问 |

## 安装说明

MinerU 是 Python 包，首次使用时由 agent 自动安装: `pip install "mineru[all]"`
如遇问题参考: https://github.com/opendatalab/MinerU
