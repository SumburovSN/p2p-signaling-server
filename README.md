Структура проекта:
```text
p2p-signaling-server/
├── server.js
├── package.json
└── turn/
    └── turnserver.conf
```
<pre>
Стратегия WebRTC:

                WebRTC
                   │
          ┌────────┴────────┐
          │                 │
       direct              TURN
          │                 │
     host/srflx         coturn VPS
          │                 │
          └───────┬─────────┘
                  │
             remote peer
</pre>

Сначала браузеры пытаются соединиться напрямую. Если это невозможно из-за NAT/firewall, используется TURN.
<pre>
server.js ────────► PeerServer
                       │
                       │ signaling
                       ▼
Browser A ◄──────────────► Browser B
</pre>

```text
coturn ◄──────────────────► Browser A
   ▲
   │ relay media
   ▼
Browser B
```
```text
ICE candidates
│
├── host
│   └── 192.168.x.x
│
├── srflx
│   └── публичный IP через STUN
│
└── relay
    └── публичный IP VPS через coturn
```

**Инструкция по установке на VDS** 
*(Virtual Dedicated Server — виртуальный выделенный сервер, услуга аренды виртуального компьютера)*
### 1. **Установить Nginx**
#### 1.1. На VPS:
```console
sudo apt install -y nginx
```
После установки:
```console
sudo systemctl enable --now nginx
```
Проверяем:
```console
systemctl status nginx --no-pager
```
Должно быть:
```console
Active: active (running)
```
#### 1.2. Проверить, что Nginx слушает 80 порт
```console
sudo ss -lntp | grep ':80'
```
Ожидаем примерно:
```console
LISTEN ... 0.0.0.0:80 ... nginx
LISTEN ... [::]:80 ... nginx
```
#### 1.3. Проверить с Windows
В PowerShell:
```console
Test-NetConnection 45.150.36.156 -Port 80
```
Нас интересует:
```console
TcpTestSucceeded : True
```
### 2.Следующий шаг — Node.js
На VPS:
```console
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```
Затем:
```console
sudo apt install -y nodejs
```
Проверяем:
```console
node -v
npm -v
```
### 3. Следующий шаг — забираем твой signaling server
Запускать его не от root, а от отдельного пользователя peerjs и разместить приложение в /opt/p2p-signaling-server.
Сначала:
```console
sudo useradd --system --create-home --shell /usr/sbin/nologin peerjs
```
Создаём каталог:
```console
sudo mkdir -p /opt/p2p-signaling-server
```
Передаём его пользователю:
```console
sudo chown -R peerjs:peerjs /opt/p2p-signaling-server
```
Теперь клонируем репозиторий:
```console
sudo -u peerjs git clone https://github.com/SumburovSN/p2p-signaling-server.git /opt/p2p-signaling-server
```
```console
cd /opt/p2p-signaling-server
```
```console
sudo -u peerjs npm ci
```
*Почему npm ci, а не npm install: поскольку уже есть package-lock.json, npm ci установит именно зафиксированные версии зависимостей.*

После этого:
```console
ls -la
```
должна появиться директория:
```console
node_modules
```
### 4. Следующий шаг — systemd
Нужно превратить PeerJS в нормальный Linux-сервис:
```text
systemd
   │
   └── peerjs.service
          │
          └── Node.js → PeerJS :9000
```
Тогда сервер будет:
* запускаться автоматически после перезагрузки VPS;
* работать независимо от SSH;
* автоматически перезапускаться при падении;
* работать от пользователя peerjs, а не root

В терминале:
```text
sudo nano /etc/systemd/system/peerjs.service
```
```console

[Unit]
Description=PeerJS Signaling Server
After=network.target

[Service]
Type=simple
User=peerjs
Group=peerjs
WorkingDirectory=/opt/p2p-signaling-server
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Проверяем unit
```console
sudo systemctl daemon-reload
```
Запускаем:
```console
sudo systemctl start peerjs
```
Проверяем:
```console
sudo systemctl status peerjs --no-pager
```
Должно быть примерно:
```console
● peerjs.service - PeerJS Signaling Server
     Loaded: loaded (...)
     Active: active (running)
```
Включаем автозапуск, когда убедимся, что всё работает:
```console
sudo systemctl enable peerjs
```
Можно сразу проверить:
```console
sudo systemctl is-enabled peerjs
```
Ожидаем:
```console
enabled
```
### 5. Следующий шаг — настроить Nginx как reverse proxy:
```text
Интернет
   ↓ HTTPS / WSS
твой_домен:443
   ↓
Nginx
   ↓ HTTP
127.0.0.1:9000
   ↓
PeerJS
```
#### 5.1. Создаём конфигурацию Nginx
На VPS:
```console
sudo nano /etc/nginx/sites-available/peerjs
```
Вставляем:
```console
server {
    listen 80;
    listen [::]:80;

    server_name твой_домен;

    location /myapp/ {
        proxy_pass http://127.0.0.1:9000/myapp/;

        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Сохраняем Ctrl+O, Enter, затем Ctrl+X.
*Последняя редакция peerjs в корне каталога. Дополнены: ssl-сертификаты; P2P Video Chat Room Manager; frontend p2p-video-chat*

#### 5.2. Включаем сайт
```console
sudo ln -s /etc/nginx/sites-available/peerjs /etc/nginx/sites-enabled/peerjs
```
Проверяем конфигурацию:
```console
sudo nginx -t
```
Если увидим:
```console
syntax is ok
test is successful
```
перезагружаем:
```console
sudo systemctl reload nginx
```
#### 5.3. Проверим через браузер/curl
На VPS:
```console
curl -i http://имя_домена/myapp/
```
Ожидаем примерно:
```console
HTTP/1.1 200 OK
...
{"name":"PeerJS Server", ...}
```

### 6. Получаем production-сертификат
*(HTTPS нужен не столько PeerJS/WebRTC, сколько браузеру для доступа к камере и микрофону)*
```text
                     PeerJS
                       │
                       ▼
              HTTP / WebSocket
                       │
                       │ можно
                       ▼
                PeerServer

      Браузер
         │
         ├── камера
         └── микрофон
               │
               ▼
         getUserMedia()
               │
               ▼
        HTTPS обязательно
        (кроме localhost)

```

```console
sudo certbot --nginx -d твой_домен
```

### 7. Следующий шаг — установка coturn
```console
sudo apt update
sudo apt install coturn
```
После установки
```console
coturn --version
systemctl status coturn --no-pager
```
#### 7.1. Настраиваем turnserver.conf

##### 7.1.1. Сначала сделаем резервную копию:
```console
sudo cp /etc/turnserver.conf /etc/turnserver.conf.backup
```
Теперь:
```console
sudo nano /etc/turnserver.conf
```
Заменить содержимое файла целиком на:
```console
# ==========================================
# coTURN для P2P VideoChat
# ==========================================

# Сетевой интерфейс / IP нашего VDS
listening-ip=157.22.190.19
relay-ip=157.22.190.19

# Основные STUN/TURN порты
listening-port=3478
tls-listening-port=5349

# ==========================================
# Аутентификация
# ==========================================

lt-cred-mech
realm=твой_домен

# ==========================================
# Relay ports
# ==========================================

min-port=49160
max-port=49200

# ==========================================
# TLS
# ==========================================

cert=/etc/letsencrypt/live/твой_домен/fullchain.pem
pkey=/etc/letsencrypt/live/твой_домен/privkey.pem

# ==========================================
# Безопасность
# ==========================================

fingerprint
no-cli
no-multicast-peers

# ==========================================
# Логирование
# ==========================================

#simple-log
#log-file=/var/log/turnserver/turnserver.log
```
#### 7.2. Сгенерируем пароль:
```console
openssl rand -base64 24
```
#### 7.3. Создаём пользователя:
```console
sudo turnadmin -a -u videochat -p 'ТВОЙ_ПАРОЛЬ' -r 'ТВОЙ_ДОМЕН'
```
Проверить его можно:
```console
sudo turnadmin -l
```
Должно быть примерно:
```console
0: videochat
```
#### 7.4. Затем проверяем конфигурацию
```console
sudo turnserver -c /etc/turnserver.conf --log-file=stdout
```
Если увидим, что сертификаты, порты и relay инициализировались нормально, тогда остановим тестовый запуск Ctrl+C и уже запустим:
```console
sudo systemctl restart coturn
```
После этого проверим:
```console
sudo ss -tulnp | grep -E '3478|5349'
```
#### 7.5. И отдельно откроем диапазон:
```console
UDP 49160–49200
```
### 8. Сделаем отдельные копии сертификата и ключа для coturn с правильными правами. 
*Это заодно будет удобнее для дальнейшего автообновления сертификата.*

#### 8.1. Создаём каталог
```console
sudo mkdir -p /etc/coturn/certs
sudo chown root:turnserver /etc/coturn/certs
sudo chmod 750 /etc/coturn/certs
```
#### 8.2. Копируем сертификаты
```console
sudo cp /etc/letsencrypt/live/твой_домен/fullchain.pem /etc/coturn/certs/fullchain.pem
sudo cp /etc/letsencrypt/live/твой_домен/privkey.pem /etc/coturn/certs/privkey.pem
```
#### 8.3. Выставляем права:
```console
sudo chown root:turnserver /etc/coturn/certs/*.pem
sudo chmod 640 /etc/coturn/certs/*.pem
```
Получится примерно:
```console
root:turnserver  fullchain.pem  640
root:turnserver  privkey.pem    640
```
#### 8.4. Проверяем именно от имени coturn
```console
sudo -u turnserver cat /etc/coturn/certs/fullchain.pem >/dev/null && echo "CERT OK"
```
и:
```console
sudo -u turnserver cat /etc/coturn/certs/privkey.pem >/dev/null && echo "KEY OK"
```
Ожидаем:
```console
CERT OK
KEY OK
```
#### 8.5. Меняем пути в /etc/turnserver.conf
```console
sudo nano /etc/turnserver.conf
```
заменим на:
```console
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem
```
Сохрани Ctrl+O, Enter, Ctrl+X.

#### 8.6. Перезапускаем coturn
```console
sudo systemctl restart coturn
```
Проверяем:
```console
sudo systemctl status coturn --no-pager
```
И самое главное:
```console
sudo ss -tulnp | grep -E '3478|5349'
```
Сейчас нам нужно увидеть примерно:
```console
udp ...:3478 ... turnserver
tcp ...:3478 ... turnserver
tcp ...:5349 ... turnserver
```
И ещё проверим конфигурацию:
```console
sudo grep -E '^(listening-port|tls-listening-port|min-port|max-port|realm|lt-cred-mech|cert|pkey)' /etc/turnserver.conf
```
Должно быть примерно:
```console
listening-port=3478
tls-listening-port=5349
lt-cred-mech
realm=твой_домен
min-port=49160
max-port=49200
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem
```
Сейчас у нас две копии сертификатов:
```еуче
Let's Encrypt
    ↓
/etc/letsencrypt/live/твой_домен/
    ├── fullchain.pem
    └── privkey.pem

        ↓ ручное копирование

/etc/coturn/certs/
    ├── fullchain.pem
    └── privkey.pem
```
При продлении Certbot обновит файлы в /etc/letsencrypt/live/.... Причём live — это штатное место, которое Certbot обновляет при renewal.

Сделаем автоматический deploy-hook Certbot:
```
Certbot успешно продлил сертификат
             ↓
      deploy-hook
             ↓
копирует новый fullchain.pem
копирует новый privkey.pem
             ↓
   root:turnserver
         640
             ↓
   restart coturn
```

Создаём каталог
```console
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
```
Создаём скрипт
```console
sudo nano /etc/letsencrypt/renewal-hooks/deploy/coturn-cert.sh
```

```console
#!/bin/bash

CERT_DIR="/etc/coturn/certs"
LE_DIR="/etc/letsencrypt/live/твой_домен"

echo "Updating coturn certificates..."

cp "$LE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
cp "$LE_DIR/privkey.pem" "$CERT_DIR/privkey.pem"

chown root:turnserver "$CERT_DIR/fullchain.pem"
chown root:turnserver "$CERT_DIR/privkey.pem"

chmod 640 "$CERT_DIR/fullchain.pem"
chmod 640 "$CERT_DIR/privkey.pem"

systemctl restart coturn

echo "Coturn certificates updated successfully."
```
Ctrl+O → Enter → Ctrl+X

Делаем скрипт исполняемым
```console
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/coturn-cert.sh
```
Проверяем:
```console
ls -l /etc/letsencrypt/renewal-hooks/deploy/coturn-cert.sh
```
Должно быть примерно:
```console
-rwxr-xr-x 1 root root ... coturn-cert.sh
```
Цепочка выглядит так:
```
Let's Encrypt
      │
      ▼
/etc/letsencrypt/live/
      │
      │ renewal-hook
      ▼
/etc/coturn/certs/
      │
      ▼
   coturn
      │
      ├── STUN :3478
      ├── TURN :3478
      └── TURNS :5349
```