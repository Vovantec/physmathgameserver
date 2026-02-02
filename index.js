require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('colyseus');
const { monitor } = require('@colyseus/monitor');
const GameRoom = require('./src/rooms/GameRoom');
const DataManager = require('./src/managers/GameDataManager');

const port = process.env.PORT || 2567;
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const gameServer = new Server({
  server: server,
});

gameServer.define('game', GameRoom);
app.use("/colyseus", monitor());

app.get("/", (req, res) => {
    res.send("Game Server Running (API Mode) 🚀");
});

// Сначала загружаем данные, потом запускаем сервер
DataManager.loadAll().then(() => {
    gameServer.listen(port);
    console.log(`Listening on ws://localhost:${port}`);
}).catch(err => {
    console.error("Failed to load game data:", err);
});