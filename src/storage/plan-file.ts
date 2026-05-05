import { readdir, access } from 'fs/promises';
import { join } from 'path';

export async function findActivePlanFile(tempDir: string): Promise<string | null> {
  try {
    const entries = await readdir(tempDir);
    for (const entry of entries) {
      if (!entry.startsWith('plan_')) continue;
      const planPath = join(tempDir, entry, 'plan.md');
      try {
        await access(planPath);
        return planPath;
      } catch {}
    }
  } catch {}
  return null;
}
