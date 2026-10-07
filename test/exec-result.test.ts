import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SSHConnectionManager, execSshCommand, execSshCommandWithConnection } from '../src/index';
import { startFakeSshServer, FakeReply, FakeSshServer } from './helpers/fakeSshServer';

const replies: Record<string, FakeReply> = {
  'clean': { stdout: 'ok\n', code: 0 },
  'warns': { stdout: 'done\n', stderr: 'warning: deprecated flag\n', code: 0 },
  'quiet-fail': { code: 3 },
  'loud-fail': { stdout: 'partial\n', stderr: 'boom\n', code: 1 },
};

let fake: FakeSshServer;
let manager: SSHConnectionManager;

beforeAll(async () => {
  fake = await startFakeSshServer((command) => replies[command] ?? { stderr: `unknown: ${command}\n`, code: 127 });
  manager = new SSHConnectionManager({ host: '127.0.0.1', port: fake.port, username: 'test', password: 'x' });
});

afterAll(async () => {
  manager.close();
  await fake.close();
});

const runners: Record<string, (command: string) => Promise<any>> = {
  execSshCommand: (command) =>
    execSshCommand({ host: '127.0.0.1', port: fake.port, username: 'test', password: 'x' }, command),
  execSshCommandWithConnection: async (command) => {
    await manager.ensureConnected();
    return execSshCommandWithConnection(manager, command);
  },
};

describe.each(Object.keys(runners))('%s result classification', (name) => {
  const run = (command: string) => runners[name](command);

  it('returns stdout alone for a clean success', async () => {
    const result = await run('clean');
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'ok\n' }]);
  });

  it('treats exit 0 with stderr as success and keeps both streams', async () => {
    const result = await run('warns');
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('done\n');
    expect(text).toContain('warning: deprecated flag');
  });

  it('treats a non-zero exit with empty stderr as failure', async () => {
    const result = await run('quiet-fail');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exit code 3');
  });

  it('keeps stdout, stderr and the exit code on failure', async () => {
    const result = await run('loud-fail');
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('partial\n');
    expect(text).toContain('boom');
    expect(text).toContain('exit code 1');
  });
});
