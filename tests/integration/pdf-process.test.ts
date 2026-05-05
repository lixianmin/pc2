import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createBashTool } from '../../src/tools/bash.js';
import { createFileReadTool } from '../../src/tools/file-read.js';
import { createFileWriteTool } from '../../src/tools/file-write.js';
import { scanSkillDirectory } from '../../src/skill-sop/loader.js';
import type { SkillDefinition } from '../../src/skill-sop/types.js';

vi.mock('../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
    SummarizeHistory: vi.fn(),
  },
}));

const PDF_DIR = '/Users/xmli/me/code/claw.cactus/docs/divorce/110二审开庭2';
const PDF_FILE = join(PDF_DIR, '（2026）京02民终1807号.pdf');
const MINERU_ENV = '/tmp/mineru-env';
const PYTHON3 = `${MINERU_ENV}/bin/python3`;
const MINERU = `${MINERU_ENV}/bin/mineru`;

describe('PDF processing integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pc2-pdf-int-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('skill file parses with correct allowedTools', async () => {
    const skills = await scanSkillDirectory('skills');
    const pdfSkill = skills.find(s => s.name === 'pdf-process');
    expect(pdfSkill).toBeDefined();
    expect(pdfSkill!.allowedTools).toContain('Bash(python3*)');
    expect(pdfSkill!.allowedTools).toContain('Bash(pip*)');
    expect(pdfSkill!.allowedTools).toContain('Bash(mineru*)');
    expect(pdfSkill!.body).toContain('pdfplumber');
  });

  it('bash tool allows python3 when skill allowedTools includes Bash(python3*)', async () => {
    const tool = createBashTool({ autoApprove: false });
    const ctx = {
      turn: 1, index: 0, lmdClient: null, dataDir: '/tmp',
      agentId: 'test', isSubAgent: false, workspaceRoot: process.cwd(),
      allowedTools: ['Bash(python3*)', 'Bash(pip*)'],
    };
    const result = await tool.execute({ command: 'python3 -c "print(42)"' }, ctx as any);
    expect(String(result.data)).not.toContain('requires approval');
    expect(String(result.data)).toContain('42');
  });

  it('bash tool blocks python3 when no allowedTools', async () => {
    const tool = createBashTool({ autoApprove: false });
    const ctx = {
      turn: 1, index: 0, lmdClient: null, dataDir: '/tmp',
      agentId: 'test', isSubAgent: false, workspaceRoot: process.cwd(),
    };
    const result = await tool.execute({ command: 'python3 -c "print(42)"' }, ctx as any);
    expect(String(result.data)).toContain('requires approval');
  });

  it('extracts PDF text with pdfplumber', async () => {
    if (!existsSync(PDF_FILE)) {
      console.warn('Skipping: PDF file not found at', PDF_FILE);
      return;
    }

    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({
      command: `${PYTHON3} -c "import pdfplumber; pdf = pdfplumber.open('${PDF_FILE}'); [print(p.extract_text()) for p in pdf.pages if p.extract_text()]; pdf.close()"`,
    }, { turn: 1, index: 0, lmdClient: null, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: process.cwd() } as any);

    const output = String(result.data);
    expect(output).toContain('民终 1807');
    expect(output).toContain('上诉人');
    expect(output).toContain('被上诉人');
  });

  it('full pdfplumber conversion writes .md file', async () => {
    if (!existsSync(PDF_FILE)) {
      console.warn('Skipping: PDF file not found at', PDF_FILE);
      return;
    }

    const outputPath = join(tempDir, '（2026）京02民终1807号.md');
    const tool = createBashTool({ autoApprove: true });

    const scriptPath = join(tempDir, 'convert.py');
    writeFileSync(scriptPath, `import pdfplumber, os
input_pdf = '${PDF_FILE}'
output_md = '${outputPath}'
pdf = pdfplumber.open(input_pdf)
all_text = []
for page in pdf.pages:
    text = page.extract_text()
    if text:
        all_text.append(text)
pdf.close()
with open(output_md, 'w', encoding='utf-8') as f:
    f.write('\\n\\n'.join(all_text))
print(f'OK: {len(pdf.pages)} pages -> {output_md}')
`);
    await tool.execute({ command: `${PYTHON3} ${scriptPath}` }, { turn: 1, index: 0, lmdClient: null, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: process.cwd() } as any);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('民终 1807');
    expect(content).toContain('上诉人');
    expect(content.length).toBeGreaterThan(500);
  });

  it('skill slash command matching logic works', () => {
    const skills: SkillDefinition[] = [
      { name: 'pdf-process', description: 'PDF', evolvable: true, filePath: '/fake' },
    ];
    const input = '/pdf-process /path/to/file.pdf';
    const matched = skills.find(s => input.startsWith('/' + s.name + ' ') || input === '/' + s.name);
    expect(matched).toBeDefined();
    const args = input.slice(('/' + matched!.name).length).trim();
    expect(args).toBe('/path/to/file.pdf');
  });

  it('mineru extracts PDF to .md with correct output path', { timeout: 300_000 }, async () => {
    if (!existsSync(PDF_FILE)) {
      console.warn('Skipping: PDF file not found at', PDF_FILE);
      return;
    }
    if (!existsSync(MINERU)) {
      console.warn('Skipping: mineru not installed at', MINERU);
      return;
    }

    const outputBase = join(tempDir, 'mineru-out');
    mkdirSync(outputBase, { recursive: true });

    const scriptPath = join(tempDir, 'run-mineru.sh');
    writeFileSync(scriptPath, `#!/bin/bash
source ${MINERU_ENV}/bin/activate
mineru -p '${PDF_FILE}' -o '${outputBase}'
echo "EXIT_CODE=$?"
`);
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({
      command: `bash ${scriptPath}`,
      timeout: 300_000,
    }, { turn: 1, index: 0, lmdClient: null, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: process.cwd() } as any);

    const stem = '（2026）京02民终1807号';
    const mdPath = join(outputBase, stem, 'hybrid_auto', `${stem}.md`);
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, 'utf-8');
    expect(content).toContain('民终 1807');
    expect(content).toContain('上诉人');
    expect(content.length).toBeGreaterThan(500);
  });
});
