// 端口转发: 让 WSL2 服务可从 LAN 访问
const net = require('net');
const fs = require('fs');
const log = m => fs.appendFileSync(__dirname + '/forward.log', new Date().toISOString() + ' ' + m + '\n');

const targets = [
  {
    listen: process.env.CRM_LAN_HOST || '192.168.8.2',
    port: 8000,
    target: '127.0.0.1',
    targetPort: 8000,
    name: '招生系统',
  },
];

targets.forEach(t => {
  const server = net.createServer(c => {
    const s = net.connect(t.targetPort, t.target);
    c.pipe(s).pipe(c);
    s.on('error', () => c.destroy());
    c.on('error', () => s.destroy());
  });
  server.on('error', e => log(`${t.name} error: ${e.message}`));
  server.listen(t.port, t.listen, () => {
    log(`${t.name}: ${t.listen}:${t.port} → ${t.target}:${t.targetPort}`);
    console.log(`${t.name}: ${t.listen}:${t.port} → ${t.target}:${t.targetPort}`);
  });
});
