import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { validateConfig } from '../src/index';

const entry = join(process.cwd(), 'src', 'index.ts');
const EXIT_TIMEOUT = 10000;

// Starts the real entry point in CLI mode. stdin stays open, so a server that
// accepts its config sits idle and the timeout fires instead of an exit.
function startServer(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.SSH_MCP_DISABLE_MAIN;
    delete env.SSH_MCP_TEST;
    const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server still running after ${EXIT_TIMEOUT}ms; stderr: ${stderr}`));
    }, EXIT_TIMEOUT);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

describe('validateConfig placeholders', () => {
  it('rejects a placeholder --host', () => {
    for (const host of ['YOUR_HOST', 'your-host', 'Your_Server', '<host>', '<HOST>']) {
      expect(() => validateConfig({ host, user: 'admin' })).toThrow(/--host.*placeholder/);
    }
  });

  it('rejects a placeholder --user', () => {
    for (const user of ['YOUR_USER', 'your-user', 'your_username', '<user>']) {
      expect(() => validateConfig({ host: '192.168.1.100', user })).toThrow(/--user.*placeholder/);
    }
  });

  it('accepts real values, including a hostname that starts with "your-"', () => {
    for (const host of ['192.168.1.100', 'example.com', 'your-server.example.com']) {
      expect(() => validateConfig({ host, user: 'admin' })).not.toThrow();
    }
    expect(() => validateConfig({ host: 'example.com', user: 'yourself' })).not.toThrow();
  });
});

describe('startup with an unusable config', () => {
  function expectCleanFailure(result: { code: number | null; stderr: string }, message: RegExp) {
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBeNull();
    const lines = result.stderr.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(message);
  }

  it('exits straight away on placeholder values', async () => {
    const result = await startServer(['--host=YOUR_HOST', '--user=YOUR_USER']);
    expectCleanFailure(result, /placeholder/);
  }, EXIT_TIMEOUT + 5000);

  it('exits with one line, not a stack trace, when --host is missing', async () => {
    const result = await startServer(['--user=admin']);
    expectCleanFailure(result, /Missing required --host/);
  }, EXIT_TIMEOUT + 5000);
});
