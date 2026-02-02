const colyseus = require('colyseus');
const { GameState, Player, NPC } = require('./schema/GameState');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Конфигурация
const API_URL = process.env.API_URL || 'http://web:3000';
const API_KEY = process.env.INTERNAL_API_KEY;

class GameRoom extends colyseus.Room {

  onCreate(options) {
    console.log("GameRoom created!");
    this.setState(new GameState());

    // 1. ЗАГРУЗКА КАРТЫ (Синхронно при старте)
    // Оригинальный maps.json - это массив массивов (слои/тайлы)
    try {
        const mapPath = path.join(__dirname, '../../data/maps.json');
        const rawMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        // Берем первый слой карты для коллизий (обычно это слой с obstacles)
        // В вашем JSON: [{"frame":5,"walkable":true}, ...]
        // Предположим, карта квадратная 40x40 (или как в клиенте window.innerWidth / 40)
        // ВАЖНО: Тут нужно знать ширину карты из оригинального проекта. 
        // Допустим, ширина 100 клеток.
        this.mapData = rawMap[0]; // Основной слой
        this.mapWidth = 100; // ПОДСТАВЬТЕ РЕАЛЬНУЮ ШИРИНУ ИЗ index.js
    } catch (e) {
        console.error("Ошибка загрузки карты:", e.message);
        this.mapData = [];
    }

    // 2. СПАВН NPC (Имитация данных из MySQL)
    this.spawnNPCs();

    // 3. ОБРАБОТЧИКИ
    
    // Движение (Игрок кликнул куда идти)
    this.onMessage("move", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        // Простейшая валидация (в реальности тут нужен A* на сервере, если хотите жесткий античит)
        // Пока просто обновляем цель, клиент сам интерполирует
        if (this.isWalkable(data.x, data.y)) {
            player.x = data.x;
            player.y = data.y;
            player.targetX = data.x;
            player.targetY = data.y;
        }
    });

    // Бой / Взаимодействие
    this.onMessage("action", (client, data) => {
        // Логика удара или разговора
    });
  }

  // Проверка проходимости (из оригинального index.js)
  isWalkable(x, y) {
      // Преобразование координат пикселей в клетки (если клиент шлет пиксели)
      // let gridX = Math.floor(x / CELL_SIZE);
      // let index = gridY * this.mapWidth + gridX;
      // return this.mapData[index] && this.mapData[index].walkable;
      return true; // Пока разрешаем всё, чтобы не застрять
  }

  async spawnNPCs() {
      // В идеале: await axios.get(`${API_URL}/api/internal/npcs`)
      // Пока создаем тестовых
      for (let i = 0; i < 5; i++) {
          const npc = new NPC();
          npc.x = 200 + (i * 50);
          npc.y = 300;
          npc.name = `Guard ${i}`;
          npc.type = "Warrior";
          // Добавляем в стейт (Colyseus сам отправит клиентам)
          this.state.npcs.set(`npc_${i}`, npc); 
      }
  }

  async onAuth(client, options) {
    if (!options.token) throw new colyseus.ServerError(400, "No token");

    try {
        const response = await axios.post(`${API_URL}/api/internal/verify-token`, 
            { token: options.token },
            { headers: { 'x-api-secret': API_KEY } }
        );
        if (!response.data.valid) throw new colyseus.ServerError(401, "Invalid");

        // Возвращаем полные данные игрока для инициализации
        return { 
            userId: response.data.userId,
            username: response.data.username,
            // Если API вернет класс и статы - берем их
            class: response.data.class || "warrior", 
            hp: response.data.hp || 100
        };
    } catch (e) {
        console.error("Auth failed:", e.message);
        throw new colyseus.ServerError(500, "Auth error");
    }
  }

  onJoin(client, options) {
    const player = new Player();
    player.x = 100;
    player.y = 100;
    player.name = client.auth.username;
    player.class = client.auth.class;
    player.hp = client.auth.hp;
    
    this.state.players.set(client.sessionId, player);
    console.log(`${player.name} joined!`);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

module.exports = GameRoom;