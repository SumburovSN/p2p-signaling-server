const { PeerServer } = require('peer');

// Хостинг сам назначит порт в process.env.PORT, а локально будет 9000
const port = process.env.PORT || 9000;

const peerServer = PeerServer({ 
  port: port, 
  path: '/myapp',
  allow_discovery: true // Помогает браузерам находить ID друг друга
});

console.log(`Сигнальный сервер запущен на порту ${port}`);
