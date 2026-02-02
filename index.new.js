require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('colyseus');
const { monitor } = require('@colyseus/monitor');

// Импорт комнаты
const GameRoom = require('./src/rooms/GameRoom');

const port = Number(process.env.PORT || 8080);
const app = express();

app.use(cors());
app.use(express.json());

// Базовый роут для проверки жизни
app.get("/", (req, res) => {
    res.send("PhysMath Game Server is running on Colyseus!");
});

// Создаем HTTP сервер
const httpServer = http.createServer(app);

// Создаем Colyseus сервер
const gameServer = new Server({
  server: httpServer,
});

// Регистрируем комнату "world"
gameServer.define('world', GameRoom);

// Подключаем мониторинг (админка сервера) по адресу /colyseus
app.use("/colyseus", monitor());

gameServer.listen(port);
console.log(`🎮 Game Server is listening on ws://localhost:${port}`);