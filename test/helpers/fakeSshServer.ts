import { Server, utils } from 'ssh2';
import type { AddressInfo } from 'net';

// An in-process SSH server on 127.0.0.1 that accepts any login and answers
// each exec request from a script, so tests need no sshd or Docker.
export interface FakeReply {
  stdout?: string;
  stderr?: string;
  code?: number;
}

export interface FakeSshServer {
  port: number;
  commands: string[];
  close(): Promise<void>;
}

export async function startFakeSshServer(reply: (command: string) => FakeReply): Promise<FakeSshServer> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const commands: string[] = [];
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
          commands.push(info.command);
          const stream = acceptExec();
          const r = reply(info.command);
          if (r.stdout) stream.write(r.stdout);
          if (r.stderr) stream.stderr.write(r.stderr);
          stream.exit(r.code ?? 0);
          stream.end();
        });
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    commands,
    close: () => new Promise<void>((resolve) => {
      for (const client of clients) client.end();
      server.close(() => resolve());
    }),
  };
}
