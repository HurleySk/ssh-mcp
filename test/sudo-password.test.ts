import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeSshServer, FakeSshServer } from './helpers/fakeSshServer';
import { callTool, CALL_TIMEOUT } from './helpers/mcpServer';

const password = "pa ss'word";

let fake: FakeSshServer;

beforeAll(async () => {
  fake = await startFakeSshServer(() => ({ stdout: 'uid=0(root)\n' }));
});

afterAll(async () => {
  await fake.close();
});

describe('sudo-exec password handling', () => {
  it('sends the sudo password on stdin, never in the remote command line', async () => {
    const res = await callTool(fake.port, [`--sudoPassword=${password}`], 'sudo-exec', { command: 'id' });
    expect(res.result?.isError).toBeFalsy();
    const command = fake.commands.at(-1)!;
    // The remote shell's argv (visible to ps) carries the command line
    expect(command).not.toContain('pa ss');
    expect(command).toMatch(/^sudo .*-S /);
    expect(fake.stdins.at(-1)).toBe(`${password}\n`);
  }, CALL_TIMEOUT + 5000);
});
