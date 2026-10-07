import { Server, utils } from 'ssh2';
import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';

// An in-process SSH server on 127.0.0.1 that accepts any login and answers
// each exec request from a script, so tests need no sshd or Docker. Like a
// command that reads its input, it replies once the client closes stdin.
export interface FakeReply {
  stdout?: string;
  stderr?: string;
  code?: number;
  hang?: boolean;
}

export interface FakeSshServer {
  port: number;
  commands: string[];
  stdins: string[];
  // Emits 'exec' with the command and 'signal' with the signal name
  events: EventEmitter;
  close(): Promise<void>;
}

export async function startFakeSshServer(reply: (command: string) => FakeReply): Promise<FakeSshServer> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const commands: string[] = [];
  const stdins: string[] = [];
  const events = new EventEmitter();
  const clients = new Set<any>();

  const server = new Server({ hostKeys: [hostKey] }, (client: any) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => { /* ignore */ });
    client.on('authentication', (ctx: any) => ctx.accept());
    client.on('ready', () => {
      client.on('session', (acceptSession: any) => {
        const session = acceptSession();
        session.on('exec', (acceptExec: any, _reject: any, info: { command: string }) => {
          const stream = acceptExec();
          const index = commands.push(info.command) - 1;
          stdins.push('');
          events.emit('exec', info.command);
          // sshd kills the session's process group; the fake ends the command
          session.on('signal', (acceptSignal: any, _rejectSignal: any, sig: { name: string }) => {
            acceptSignal && acceptSignal();
            events.emit('signal', sig.name);
            stream.exit(sig.name);
            stream.end();
          });
          stream.on('data', (d: Buffer) => { stdins[index] += d.toString(); });
          stream.on('end', () => {
            const r = reply(info.command);
            if (r.hang) return;
            if (r.stdout) stream.write(r.stdout);
            if (r.stderr) stream.stderr.write(r.stderr);
            stream.exit(r.code ?? 0);
            stream.end();
          });
        });
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    commands,
    stdins,
    events,
    close: () => new Promise<void>((resolve) => {
      for (const client of clients) client.end();
      server.close(() => resolve());
    }),
  };
}
