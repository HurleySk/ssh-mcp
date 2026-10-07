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
  // Emits 'exec' and 'eof' (stdin closed) with the command, and 'signal'
  // with the signal name
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

    // ssh2's server drops channel requests once a command is running, so
    // signal requests are caught at the protocol layer. sshd answers one by
    // killing the session's process group; the fake ends that command.
    const running = new Map<number, any>();
    const handlers = client._protocol._handlers;
    const onRequest = handlers.CHANNEL_REQUEST;
    handlers.CHANNEL_REQUEST = (p: any, recipient: number, type: string, wantReply: boolean, data: any) => {
      const stream = running.get(recipient);
      if (type === 'signal' && stream) {
        events.emit('signal', data);
        stream.exit(data);
        stream.end();
        return;
      }
      return onRequest(p, recipient, type, wantReply, data);
    };

    client.on('ready', () => {
      client.on('session', (acceptSession: any) => {
        const session = acceptSession();
        session.on('exec', (acceptExec: any, _reject: any, info: { command: string }) => {
          const stream = acceptExec();
          running.set(stream.incoming.id, stream);
          stream.on('close', () => running.delete(stream.incoming.id));
          const index = commands.push(info.command) - 1;
          stdins.push('');
          events.emit('exec', info.command);
          stream.on('data', (d: Buffer) => { stdins[index] += d.toString(); });
          stream.on('end', () => {
            events.emit('eof', info.command);
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
