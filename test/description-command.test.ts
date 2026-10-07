import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeSshServer, FakeSshServer } from './helpers/fakeSshServer';
import { callTool, CALL_TIMEOUT } from './helpers/mcpServer';

let fake: FakeSshServer;

beforeAll(async () => {
  fake = await startFakeSshServer(() => ({ stdout: 'hello\n' }));
});

afterAll(async () => {
  await fake.close();
});

const heredoc = 'cat <<EOF\nhello\nEOF';

describe('description is informational only', () => {
  it('exec runs the command exactly as given', async () => {
    const res = await callTool(fake.port, [], 'exec', { command: heredoc, description: 'Print a greeting # via heredoc' });
    expect(res.result?.isError).toBeFalsy();
    expect(fake.commands.at(-1)).toBe(heredoc);
  }, CALL_TIMEOUT + 5000);

  it('sudo-exec wraps the command without the description', async () => {
    const res = await callTool(fake.port, [], 'sudo-exec', { command: heredoc, description: 'Print a greeting' });
    expect(res.result?.isError).toBeFalsy();
    expect(fake.commands.at(-1)).toBe(`sudo -n sh -c '${heredoc}'`);
  }, CALL_TIMEOUT + 5000);
});
