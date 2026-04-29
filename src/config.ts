import { LogLevel } from './lib/logo.js';

export const config = {
  // GLM model context window size in tokens
  modelContextWindow: 100_000,
  // Freeze messages when token count reaches 30% of context window (leaves room for system prompt + response)
  freezeThreshold: () => config.modelContextWindow * 0.3,
  // Max agent loop rounds before forced stop — prevents infinite loops
  maxRounds: 30,
  // Max sub-agent rounds (sub-agents should complete tasks faster)
  subAgentMaxRounds: 15,
  // 20 min timeout for main agent — complex tasks with tool calls need time
  agentTimeoutMs: 20 * 60 * 1000,
  // 10 min timeout for sub-agents — simpler tasks, shorter leash
  subAgentTimeoutMs: 10 * 60 * 1000,
  // Warn about possible loop every N turns
  antiLoopInterval: 7,
  // Force ask_user injection after this many turns — prevents agent from running indefinitely
  forceAskUserTurn: 25,
  // Anti-loop threshold: abort if this many consecutive failures
  antiLoopThreshold: 3,
  // Danger turn threshold: hard stop with warning
  dangerTurnThreshold: 60,
  // 1 min heartbeat interval for sub-agent liveness checks
  subAgentHeartbeatMs: 60 * 1000,
  // LMD memory service port
  lmdPort: 12345,
  lmdHost: 'localhost',
  // 2 min cron check interval — balances responsiveness vs CPU usage
  cronCheckIntervalMs: 120_000,
  // 30 min autonomous idle timeout — stops reflect if no new input
  autonomousIdleMs: 1_800_000,
  timezone: 'Asia/Shanghai',
  dataDir: 'data',
  tempDir: 'temp',
  workspaceRoot: process.cwd(),
  logDir: 'logs',
  logLevel: LogLevel.Info,
  // 10 MB max log file size before rotation
  logMaxFileSize: 10 * 1024 * 1024,
  webSearchUrl: process.env.WEB_SEARCH_URL ?? 'http://127.0.0.1:5001',
};
