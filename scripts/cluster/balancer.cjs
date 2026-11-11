'use strict';
// Non-sticky round-robin TCP balancer for the cluster acceptance run: every new
// connection (HTTP request or WebSocket) goes to the next Strapi process in turn.
// Network partitions: the parent process sends `{ partition: port, ms }` over
// IPC; all connections to that process are cut and it gets no new ones for `ms`.
const net = require('node:net');

const listen = Number(process.env.MEX_CLUSTER_BALANCER_PORT || 1480);
const ports = String(process.env.MEX_CLUSTER_PORTS || '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const isolatedUntil = new Map();
const open = new Map(ports.map((port) => [port, new Set()]));
let next = 0;

const available = (port) => (isolatedUntil.get(port) || 0) < Date.now();

process.on('message', (message) => {
  if (message && message.partition) {
    const port = Number(message.partition);
    isolatedUntil.set(port, Date.now() + Number(message.ms || 5000));
    for (const pair of open.get(port) || []) pair.forEach((socket) => socket.destroy());
  }
});

net
  .createServer((client) => {
    const tryConnect = (attempt) => {
      const port = ports[next++ % ports.length];
      if (!available(port)) {
        if (attempt < ports.length) tryConnect(attempt + 1);
        else client.destroy();
        return;
      }
      const backend = net.connect(port, '127.0.0.1');
      const pair = [client, backend];
      backend.once('connect', () => {
        open.get(port).add(pair);
        client.pipe(backend).pipe(client);
      });
      backend.once('error', () => {
        // A stopped process: try the next one, like a load balancer health check would.
        open.get(port).delete(pair);
        if (attempt < ports.length) tryConnect(attempt + 1);
        else client.destroy();
      });
      backend.once('close', () => {
        open.get(port).delete(pair);
        client.destroy();
      });
      client.once('error', () => backend.destroy());
      client.once('close', () => backend.destroy());
    };
    tryConnect(1);
  })
  .listen(listen, '127.0.0.1', () => console.log(`balancer on ${listen} -> ${ports.join(',')}`));
