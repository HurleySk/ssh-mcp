import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { SSHConnectionManager, execSshCommandWithConnection } from '../src/index';

// Stands in for the elevated pty shell: each line written is echoed back,
// followed by its output and then a root prompt, in separate chunks. Besides
// the scripted programs it understands `echo "..."`, expanding $?.
function fakeRootShell(programs: Record<string, { output: string; code: number }>) {
  const shell: any = new EventEmitter();
  let lastCode = 0;
  let pending = '';
  shell.write = (data: string) => {
    pending += data;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const echo = /^echo "(.*)"$/.exec(line);
      let output: string;
      if (echo) {
        output = echo[1].replace('$?', String(lastCode)) + '\n';
        lastCode = 0;
      } else {
        const program = programs[line] ?? { output: `sh: ${line}: not found\n`, code: 127 };
        output = program.output;
        lastCode = program.code;
      }
      const chunks = [`${line}\r\n`, ...output.split(/(?<=\n)/).map((l) => l.replace(/\n$/, '\r\n')), 'root@box:~# '];
      for (const chunk of chunks) setImmediate(() => shell.emit('data', Buffer.from(chunk)));
    }
  };
  return shell;
}

function elevatedManager(shell: any) {
  const manager = new SSHConnectionManager({ host: '127.0.0.1', port: 22, username: 'test' });
  (manager as any).conn = {};
  (manager as any).suShell = shell;
  return manager;
}

describe('su shell command completion', () => {
  it('keeps output lines that contain #', async () => {
    const shell = fakeRootShell({
      'cat /etc/hosts': { output: '# static table\n127.0.0.1 localhost\n', code: 0 },
    });
    const result: any = await execSshCommandWithConnection(elevatedManager(shell), 'cat /etc/hosts');
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('# static table');
    expect(text).toContain('127.0.0.1 localhost');
    expect(text).not.toContain('cat /etc/hosts');
    expect(text).not.toContain('root@box');
  });

  it('reports the exit code of a failing command', async () => {
    const shell = fakeRootShell({ 'false': { output: '', code: 1 } });
    const result: any = await execSshCommandWithConnection(elevatedManager(shell), 'false');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exit code 1');
  });
});
