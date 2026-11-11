'use strict';
// Non-sticky round-robin TCP balancer for the cluster acceptance run: every new
// connection (HTTP request or WebSocket) goes to the next Strapi process in turn.
const net = require('node:net');

const listen = Number(process.env.MEX_CLUSTER_BALANCER_PORT || 1480);
const ports = String(process.env.MEX_CLUSTER_PORTS || '')
  .split(',')
  .filter(Boolean)
  .map(Number);
let next = 0;
net
  .createServer((client) => {
    const tryConnect = (attempt) => {
      const backend = net.connect(ports[next++ % ports.length], '127.0.0.1');
      backend.once('connect', () => {
        client.pipe(backend).pipe(client);
      });
      backend.once('error', () => {
        // A stopped process: try the next one, like a load balancer health check would.
        if (attempt < ports.length) tryConnect(attempt + 1);
        else client.destroy();
      });
      client.once('error', () => backend.destroy());
      client.once('close', () => backend.destroy());
    };
    tryConnect(1);
  })
  .listen(listen, '127.0.0.1', () => console.log(`balancer on ${listen} -> ${ports.join(',')}`));
