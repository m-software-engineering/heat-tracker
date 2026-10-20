import net from "node:net";

/**
 * Just enough of the Postgres wire protocol for `select 1` (simple and extended query), with no
 * auth or SSL. `terminateAll()` closes every server-side socket, like `pg_terminate_backend` or
 * `pg_ctl stop -m fast`.
 */
export const startFakePostgres = async () => {
  const sockets = new Set<net.Socket>();
  let queries = 0;

  const message = (type: string, body: Buffer = Buffer.alloc(0)) => {
    const header = Buffer.alloc(5);
    header.write(type, 0, "ascii");
    header.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([header, body]);
  };
  const int32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    return b;
  };
  const cstring = (s: string) => Buffer.from(`${s}\0`);
  const ready = () => message("Z", Buffer.from("I"));
  const complete = () => message("C", cstring("SELECT 0"));

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 4) return;
          const len = buffer.readInt32BE(0);
          if (buffer.length < len) return;
          buffer = buffer.subarray(len);
          started = true;
          socket.write(Buffer.concat([message("R", int32(0)), ready()]));
          continue;
        }
        if (buffer.length < 5) return;
        const type = String.fromCharCode(buffer[0]);
        const len = buffer.readInt32BE(1);
        if (buffer.length < len + 1) return;
        buffer = buffer.subarray(len + 1);
        if (type === "Q") {
          queries += 1;
          socket.write(Buffer.concat([complete(), ready()]));
        } else if (type === "P") socket.write(message("1"));
        else if (type === "B") socket.write(message("2"));
        else if (type === "D") socket.write(message("n"));
        else if (type === "E") {
          queries += 1;
          socket.write(complete());
        } else if (type === "S") socket.write(ready());
        else if (type === "X") socket.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `postgres://heat:secret@127.0.0.1:${port}/heat_tracker`,
    queries: () => queries,
    openConnections: () => sockets.size,
    terminateAll: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      })
  };
};
