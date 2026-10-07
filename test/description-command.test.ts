import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { startFakeSshServer, FakeSshServer } from './helpers/fakeSshServer';

const entry = join(process.cwd(), 'src', 'index.ts');
const CALL_TIMEOUT = 15000;

let fake: FakeSshServer;

beforeAll(async () => {
  fake = await startFakeSshServer(() => ({ stdout: 'hello\n' }));
});

afterAll(async () => {
  await fake.close();
});

// Starts the real server against the fake SSH server and makes one tool call.
function callTool(name: string, args: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.SSH_MCP_DISABLE_MAIN;
    delete env.SSH_MCP_TEST;
    const child = spawn(process.execPath, [
      '--import', 'tsx', entry,
      '--host=127.0.0.1', `--port=${fake.port}`, '--user=test', '--password=x',
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('no tool response')); }, CALL_TIMEOUT);
    let buffer = '';
    child.stdout.on('data', (d) => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const msg = JSON.parse(line);
        if (msg.id === 0) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n');
        } else if (msg.id === 1) {
          clearTimeout(timer);
          child.kill();
          resolve(msg);
        }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }) + '\n');
  });
}

const heredoc = 'cat <<EOF\nhello\nEOF';

describe('description is informational only', () => {
  it('exec runs the command exactly as given', async () => {
    const res = await callTool('exec', { command: heredoc, description: 'Print a greeting # via heredoc' });
    expect(res.result?.isError).toBeFalsy();
    expect(fake.commands.at(-1)).toBe(heredoc);
  }, CALL_TIMEOUT + 5000);

  it('sudo-exec wraps the command without the description', async () => {
    const res = await callTool('sudo-exec', { command: heredoc, description: 'Print a greeting' });
    expect(res.result?.isError).toBeFalsy();
    expect(fake.commands.at(-1)).toBe(`sudo -n sh -c '${heredoc}'`);
  }, CALL_TIMEOUT + 5000);
});
