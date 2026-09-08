const { PeerServer } = require('peer');

// Запускаем сервер на порту, который выдаст хостинг (или 9000 локально)
const port = process.env.PORT || 9000;

const peerServer = PeerServer({ 
  port: port, 
  path: '/myapp' 
});

console.log(`Сигнальный сервер PeerJS успешно запущен на порту ${port}`);
