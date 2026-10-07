import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { SSHConnectionManager, execSshCommand, execSshCommandWithConnection } from '../src/index';
import { startFakeSshServer, FakeSshServer } from './helpers/fakeSshServer';

let fake: FakeSshServer;
let manager: SSHConnectionManager;

beforeAll(async () => {
  fake = await startFakeSshServer((command) => (command === 'hang' ? { hang: true } : { stdout: 'ok\n' }));
  manager = new SSHConnectionManager({ host: '127.0.0.1', port: fake.port, username: 'test', password: 'x' });
  await manager.connect();
});

afterAll(async () => {
  manager.close();
  await fake.close();
});

afterEach(() => {
  vi.useRealTimers();
});

const runners: Record<string, (command: string) => Promise<any>> = {
  execSshCommand: (command) =>
    execSshCommand({ host: '127.0.0.1', port: fake.port, username: 'test', password: 'x' }, command),
  execSshCommandWithConnection: (command) => execSshCommandWithConnection(manager, command),
};

describe.each(Object.keys(runners))('%s timeout', (name) => {
  it('signals only its own session, without running pkill', async () => {
    // Only the command timeout is faked; the sockets stay real
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The client closes stdin once its exec callback has the channel
    const started = new Promise((resolve) => fake.events.once('eof', resolve));
    const result = runners[name]('hang');
    const outcome = expect(result).rejects.toThrow('timed out');
    await started;

    // Whatever the server sees next after the timeout: a signal or another command
    const next = new Promise<string>((resolve) => {
      fake.events.once('signal', (signal) => resolve(`signal ${signal}`));
      fake.events.once('exec', (command) => resolve(`exec ${command}`));
    });
    await vi.advanceTimersByTimeAsync(60000);
    await outcome;
    vi.useRealTimers();
    const nothing = new Promise<string>((resolve) => setTimeout(() => resolve('nothing within 2s'), 2000));
    expect(await Promise.race([next, nothing])).toBe('signal KILL');
  });
});

describe('persistent connection after a timeout', () => {
  it('still runs the next command', async () => {
    const result = await execSshCommandWithConnection(manager, 'clean');
    expect(result.content).toEqual([{ type: 'text', text: 'ok\n' }]);
  });
});
