import { spawn } from 'child_process';
import { join } from 'path';

const entry = join(process.cwd(), 'src', 'index.ts');
export const CALL_TIMEOUT = 15000;

// Starts the real server in CLI mode against an SSH server on 127.0.0.1 and
// makes one tool call, resolving with the JSON-RPC response.
export function callTool(port: number, serverArgs: string[], name: string, args: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.SSH_MCP_DISABLE_MAIN;
    delete env.SSH_MCP_TEST;
    const child = spawn(process.execPath, [
      '--import', 'tsx', entry,
      '--host=127.0.0.1', `--port=${port}`, '--user=test', '--password=x', ...serverArgs,
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
