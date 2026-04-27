import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Logo, LogLevel } from '../../../src/lib/logo.js';

const TEST_DIR = path.join(__dirname, 'tmp-logo');

describe('Logo', () => {
  let testLogo: Logo;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    testLogo = new Logo();
    testLogo.init({ logDir: TEST_DIR, console: false, level: LogLevel.Debug, maxFileSize: 1024, maxArchives: 2 });
  });

  afterEach(async () => {
    testLogo.close();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes info log to info.log', async () => {
    testLogo.info('test message');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toContain('[I] test message');
  });

  it('formats timestamp as YYYY-MM-DD HH:mm:ss.SSS', async () => {
    testLogo.info('format test');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('includes caller file and line', async () => {
    testLogo.info('caller test');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).not.toContain('logo.ts:');
    expect(content).toMatch(/\w+\.ts:\d+/);
  });

  it('cascades error to error.log + warn.log + info.log', async () => {
    testLogo.error('cascade test');
    testLogo.close();
    const errorContent = await fs.readFile(path.join(TEST_DIR, 'error.log'), 'utf-8');
    const warnContent = await fs.readFile(path.join(TEST_DIR, 'warn.log'), 'utf-8');
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(errorContent).toContain('[E] cascade test');
    expect(warnContent).toContain('[E] cascade test');
    expect(infoContent).toContain('[E] cascade test');
  });

  it('cascades warn to warn.log + info.log', async () => {
    testLogo.warn('warn cascade');
    testLogo.close();
    const warnContent = await fs.readFile(path.join(TEST_DIR, 'warn.log'), 'utf-8');
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(warnContent).toContain('[W] warn cascade');
    expect(infoContent).toContain('[W] warn cascade');
  });

  it('filters by level', async () => {
    testLogo.close();
    testLogo = new Logo();
    testLogo.init({ logDir: TEST_DIR, console: false, level: LogLevel.Warn, maxFileSize: 1024 });
    testLogo.debug('should not appear');
    testLogo.info('should not appear');
    testLogo.warn('should appear');
    testLogo.close();
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(infoContent).not.toContain('should not appear');
    expect(infoContent).toContain('should appear');
  });

  it('serializes objects as JSON', async () => {
    testLogo.info('data test', { tokens: 150, latency_ms: 1200 });
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toContain('"tokens":150');
    expect(content).toContain('"latency_ms":1200');
  });

  it('rolls file when exceeding maxFileSize', async () => {
    for (let i = 0; i < 120; i++) {
      testLogo.info(`rolling test line ${i} with padding to make it longer than usual`);
    }
    testLogo.close();
    const archiveDir = path.join(TEST_DIR, 'archive');
    const exists = await fs.access(archiveDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('does not write to console when console:false', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    testLogo.close();
    testLogo = new Logo();
    testLogo.init({ logDir: TEST_DIR, console: false, maxFileSize: 1024 });
    testLogo.info('no console');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('writes to stderr when console:true', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    testLogo.close();
    testLogo = new Logo();
    testLogo.init({ logDir: TEST_DIR, console: true, maxFileSize: 1024 });
    testLogo.info('yes console');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('close is idempotent', () => {
    testLogo.close();
    testLogo.close();
    testLogo.close();
  });
});
