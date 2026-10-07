import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SSHConnectionManager, execSshCommandWithConnection } from '../src/index';

afterEach(() => {
  vi.useRealTimers();
});

describe('persistent connection timeout', () => {
  it('closes the channel of a command that times out', async () => {
    vi.useFakeTimers();
    // A channel whose command never finishes
    const stream: any = new EventEmitter();
    stream.stderr = new EventEmitter();
    stream.write = vi.fn();
    stream.end = vi.fn();
    stream.close = vi.fn();
    const manager = new SSHConnectionManager({ host: '127.0.0.1', port: 22, username: 'test' });
    (manager as any).conn = { exec: (_command: string, cb: Function) => cb(undefined, stream) };

    const result = execSshCommandWithConnection(manager, 'sleep 3600');
    const outcome = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60000);
    await outcome;
    expect(stream.close).toHaveBeenCalled();
  });
});
