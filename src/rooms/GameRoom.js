const colyseus = require('colyseus');
const { GameState, Player, NPC } = require('./schema/GameState');
const axios = require('axios');
const DataManager = require('../managers/GameDataManager');
const path = require('path');
const fs = require('fs');

const BattleManager = require('../managers/BattleManager');
const PartyManager = require('../managers/PartyManager');

const API_URL = process.env.API_URL || 'http://web:3000';
const API_KEY = process.env.INTERNAL_API_KEY;

// Константы слотов экипировки
const INVENTORY_TYPE_SLOTS = {
    "0": "Шлем",
    "1": "Верх",
    "2": "Низ",
    "3": "Перчатки",
    "4": "Пояс",
    "5": "Ботинки",
    "6": "Меч, Топор, Лук, Арбалет, Посох",
    "8": "Наручи",
    "9": "Наплечники",
    "10": "Плащ",
    "11": "Кольцо",
    "12": "Серьга",
    "13": "Ожерелье",
    "14": "Щит, Стрелы, Болты",
};

class GameRoom extends colyseus.Room {
  // Размер тайла для расчетов движения
  tileSize = 64;

  async onCreate(options) {
    console.log("!!! GameRoom JS UPDATED VERSION LOADED !!!");
    console.log("GameRoom created with options:", options);
    
    this.setState(new GameState());

    // 1. Загрузка карты
    try {
        const mapPath = path.join(__dirname, '../../data/maps.json');
        if (fs.existsSync(mapPath)) {
            const rawMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            this.mapData = rawMap; 
            console.log(`Map loaded. Rows: ${this.mapData.length}`);
        } else {
            this.mapData = [];
            console.warn("Map file not found or empty.");
        }
    } catch (e) {
        console.error("Error loading map:", e.message);
        this.mapData = [];
    }

    // 2. Спавн NPC
    this.spawnNPCs();

    // ================== ОБРАБОТЧИКИ СООБЩЕНИЙ ==================

    // 1. ИНВЕНТАРЬ (Исправление ошибки "not registered")
    this.onMessage("requestInventory", (client) => {
        const inventory = client.auth && client.auth.inventory ? client.auth.inventory : [];
        // Отправляем оба события для надежности
        client.send("inventory", inventory); 
        client.send("inventory:update", inventory);
    });

    this.onMessage("inventory:swap", (client, data) => {
        this.handleInventorySwap(client, data.oldPos, data.newPos);
    });
    // Алиас для нового клиента
    this.onMessage("inventorySwap", (client, data) => {
        this.handleInventorySwap(client, data.from, data.to);
    });

    // 2. ПЕРЕМЕЩЕНИЕ
    // Старое мгновенное перемещение (для отладки)
    this.onMessage("move", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.targetX = data.x;
            player.targetY = data.y;
            player.pathQueue = []; // Сброс пути
        }
    });

    // Движение по пути (основное)
    this.onMessage("movePath", (client, message) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !message.path || !Array.isArray(message.path)) return;

        // Конвертируем координаты сетки (тайлы) в пиксели
        // Клиент шлет: [[10, 5], [10, 6], ...]
        const pixelPath = message.path.map(point => ({
            x: point[0] * this.tileSize + this.tileSize / 2,
            y: point[1] * this.tileSize + this.tileSize / 2
        }));

        // Простая защита от телепорта: проверяем дистанцию до первой точки
        if (pixelPath.length > 0) {
            const dist = Math.hypot(pixelPath[0].x - player.x, pixelPath[0].y - player.y);
            // Если прыжок больше 3 тайлов, игнорируем (защита от читов/лагов)
            if (dist > this.tileSize * 3) {
                 return; 
            }
        }
        
        // Записываем очередь движения, update() будет двигать игрока
        player.pathQueue = pixelPath;
    });

    // 3. ЧАТ
    this.onMessage("chat", (client, message) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            this.broadcast("chat", {
                id: client.sessionId,
                name: player.name,
                text: message
            });
        }
    });

    // 4. ВЗАИМОДЕЙСТВИЕ (NPC)
    this.onMessage("npcInteract", (client, data) => {
        const npcKey = data.id || data.targetId;
        this.handleInteract(client, npcKey);
    });
    
    // Legacy interact
    this.onMessage("interact", (client, data) => {
        this.handleInteract(client, data.targetId);
    });

    // 5. ДИАЛОГИ
    this.onMessage("dialogResponse", (client, data) => {
        if (data.optionId !== -1) {
             // Если нужно переходить к следующему узлу диалога
             // Пока просто закрываем или реализуем логику переходов по ID
             // this.handleDialog(client, data.optionId, "NPC");
        }
    });
    
    this.onMessage("dialog:continue", (client, data) => {
        this.handleDialog(client, data.dialogId, data.npcName);
    });

    // 6. КАРТА
    this.onMessage("requestMap", (client) => {
        if (this.mapData && this.mapData.length > 0) {
            client.send("mapData", this.mapData);
        }
    });

    // Инициализация менеджеров
    this.battleManager = new BattleManager(this);
    this.partyManager = new PartyManager(this);

    // 7. БОЙ И ГРУППА
    this.onMessage("battle:action", (client, data) => {
        this.battleManager.handleAction(client, data);
    });

    this.onMessage("party:invite", (client, data) => {
        this.partyManager.handleInvite(client, data.targetSessionId);
    });
    this.onMessage("party:accept", (client, data) => {
        this.partyManager.handleAccept(client, data.partyId);
    });
    this.onMessage("party:leave", (client, data) => {
        this.partyManager.handleLeave(client);
    });

    // ИГРОВОЙ ЦИКЛ (50 FPS по умолчанию в Colyseus)
    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
    
    // АВТОСОХРАНЕНИЕ: Каждые 30 секунд
    this.clock.setInterval(() => {
        this.clients.forEach(client => {
            this.savePlayerState(client);
        });
    }, 30000);
  }

  // ================== ОБНОВЛЕНИЕ СОСТОЯНИЯ (LOOP) ==================
  update(deltaTime) {
      const dtSeconds = deltaTime / 1000;
      
      this.state.players.forEach(player => {
          // Обработка очереди путей (плавное движение на сервере)
          if (player.pathQueue && player.pathQueue.length > 0) {
              const target = player.pathQueue[0];
              const dx = target.x - player.x;
              const dy = target.y - player.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              // Скорость игрока (или дефолтная)
              const speed = player.speed || 200; 
              const moveStep = speed * dtSeconds;

              if (distance <= moveStep) {
                  // Дошли до точки
                  player.x = target.x;
                  player.y = target.y;
                  player.pathQueue.shift(); 
              } else {
                  // Двигаемся к точке
                  player.x += (dx / distance) * moveStep;
                  player.y += (dy / distance) * moveStep;
              }
              
              // Обновляем targetX/Y для клиента
              player.targetX = player.x;
              player.targetY = player.y;
          }
      });
  }

  // ================== АВТОРИЗАЦИЯ И ВХОД ==================
  
  async onAuth(client, options) {
      if (!options.token) throw new colyseus.ServerError(400, "No token provided");

      try {
        // 1. Проверяем токен через API сайта
        const verifyRes = await axios.post(`${API_URL}/api/internal/verify-token`, 
            { token: options.token }, 
            { headers: { 'x-api-secret': API_KEY } }
        );
        
        if (!verifyRes.data.valid) throw new colyseus.ServerError(401, "Invalid Token");
        
        const userId = verifyRes.data.userId;

        // 2. Получаем данные персонажа
        const charRes = await axios.get(`${API_URL}/api/internal/character`, {
            params: { userId: userId },
            headers: { 'x-api-secret': API_KEY }
        });
        
        const charData = charRes.data.character;
        if (!charData) throw new colyseus.ServerError(404, "Character not found");

        // 3. Парсим инвентарь
        let inventory = [];
        try {
             const rawInv = JSON.parse(charData.inventory || "[]");
             // Обогащаем инвентарь данными из DataManager (картинки, названия)
             inventory = rawInv.map(slotItem => {
                 if (slotItem.coins) return slotItem;
                 const baseItem = DataManager.getItem(slotItem.id);
                 return baseItem ? { ...baseItem, ...slotItem } : slotItem;
             });
        } catch(e) {
            console.error("Inventory parse error:", e);
        }

        // Возвращаем данные в client.auth
        return { userId, dbData: charData, inventory };

    } catch (e) {
        if (e.response) {
            console.error(`Auth Error: ${e.response.status} - ${JSON.stringify(e.response.data)}`);
        } else {
            console.error("Auth Connection Error:", e.message);
        }
        throw new colyseus.ServerError(500, "Authentication failed");
    }
  }

  onJoin(client, options) {
    console.log(`Client ${client.sessionId} joined successfully.`);
    
    const data = client.auth.dbData;
    const inventory = client.auth.inventory;

    // Создаем сущность игрока в стейте
    const player = new Player();
    player.id = client.sessionId;
    player.name = data.name;
    player.level = data.level || 1;
    player.class = data.class || "Воин";
    player.exp = data.exp || 0;
    
    const classessNameRu = ['Воин', 'Рыцарь', 'Лучник', 'Маг', 'Жрец'];
    player.skin = classessNameRu.indexOf(data.class);
    if (player.skin === -1) player.skin = 0;
    player.avatar = `images/gui/resource/Textures/Unit Frames/Main/Avatar/${player.skin}.png`;

    // Устанавливаем координаты
    if (data.arrMap && data.arrMap.includes('-')) {
        const coords = data.arrMap.split('-');
        player.x = parseInt(coords[0]) * this.tileSize + this.tileSize/2 || 100;
        player.y = parseInt(coords[1]) * this.tileSize + this.tileSize/2 || 100;
    } else {
        player.x = 200; 
        player.y = 200;
    }
    player.targetX = player.x;
    player.targetY = player.y;

    // Рассчитываем статы (HP, Attack и т.д.)
    this.calcAttributes(player, data, inventory);

    // Добавляем игрока в мир
    this.state.players.set(client.sessionId, player);
    
    // ОТПРАВЛЯЕМ ИНВЕНТАРЬ (Важно для клиента!)
    client.send("inventory", inventory);
    client.send("inventory:update", inventory);
  }

  async onLeave(client, consented) {
    console.log(`Client left: ${client.sessionId}`);
    
    this.partyManager.handleLeave(client);
    
    // Сохраняем перед выходом
    await Promise.all([
        this.savePlayerState(client),
        this.savePlayerInventory(client)
    ]);

    this.state.players.delete(client.sessionId);
  }

  // ================== МЕТОДЫ СОХРАНЕНИЯ ==================

  async savePlayerState(client) {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      try {
          // Конвертируем пиксели обратно в тайлы для БД
          const gx = Math.floor(player.x / this.tileSize);
          const gy = Math.floor(player.y / this.tileSize);

          await axios.post(`${API_URL}/api/internal/save/character`, {
              userId: client.auth.userId,
              level: player.level,
              exp: player.exp,
              hp: player.hp,
              arrMap: `${gx}-${gy}`, // Сохраняем как строку тайлов
              x: Math.floor(player.x), // Можно сохранять и пиксели, если API поддерживает
              y: Math.floor(player.y)
          }, { headers: { 'x-api-secret': API_KEY } });
      } catch (e) {
          console.error(`Failed to save state for ${player.name}:`, e.message);
      }
  }

  async savePlayerInventory(client) {
      if (!client.auth.inventory) return;
      try {
          // Минимизируем данные (только ID и изменяемые поля)
          const inventoryMin = client.auth.inventory.map(item => {
             if (item.coins) return item; 
             return { id: item.id, pos: item.pos, grade: item.grade, count: item.count || 1 };
          });

          await axios.post(`${API_URL}/api/internal/save/inventory`, {
              userId: client.auth.userId,
              inventory: JSON.stringify(inventoryMin)
          }, { headers: { 'x-api-secret': API_KEY } });
      } catch (e) {
          console.error("Failed to save inventory:", e.message);
      }
  }

  // ================== ЛОГИКА ИНВЕНТАРЯ ==================

  handleInventorySwap(client, oldPos, newPos) {
      const inventory = client.auth.inventory;
      const oldPosItem = inventory.find(o => o.pos == oldPos);
      const newPosItem = inventory.find(o => o.pos == newPos);
      const player = this.state.players.get(client.sessionId);

      if (!oldPosItem) return;

      // Проверка слотов экипировки
      if (INVENTORY_TYPE_SLOTS.hasOwnProperty(newPos)) {
          const slotTypes = INVENTORY_TYPE_SLOTS[newPos]; 
          // slotTypes может быть строкой "Шлем" или массивом. Приводим к строке для проверки.
          // В вашем старом коде проверка была простой, адаптируем:
          const typeList = slotTypes.split(',').map(s => s.trim());
          
          if (!typeList.includes(oldPosItem.type)) {
              client.send("notif", { message: `Слот не подходит`, type: "error" });
              return;
          }
      }

      // Свап
      if (newPosItem) {
          oldPosItem.pos = newPos;
          newPosItem.pos = oldPos;
      } else {
          oldPosItem.pos = newPos;
      }

      // Сохраняем изменения и пересчитываем статы
      this.savePlayerInventory(client);
      
      if (oldPos <= 14 || newPos <= 14) {
          this.calcAttributes(player, client.auth.dbData, inventory);
      }

      // Отправляем обновление
      client.send("inventory", inventory);
      client.send("inventory:update", inventory);
  }

  // ================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ==================

  calcAttributes(playerSchema, dbData, inventory) {
      // Базовые атрибуты + бонусы от вещей
      const needAttr = [
        'strength', 'agility', 'endurance', 'intelligence', 
        'patk', 'matk', 'pdef', 'mdef'
      ];
      const bonuses = {};
      needAttr.forEach(attr => bonuses[attr + 'Bonus'] = 0);

      inventory.forEach(item => {
          if (!item || item.coins) return;
          const pos = parseInt(item.pos);
          if (isNaN(pos) || pos > 14) return; // Только надетые вещи

          needAttr.forEach(attr => {
              if (item[attr]) bonuses[attr + 'Bonus'] += Number(item[attr]);
          });
      });

      playerSchema.strength = (dbData.strength || 0) + bonuses.strengthBonus;
      playerSchema.agility = (dbData.agility || 0) + bonuses.agilityBonus;
      playerSchema.endurance = (dbData.endurance || 0) + bonuses.enduranceBonus;
      playerSchema.intelligence = (dbData.intelligence || 0) + bonuses.intelligenceBonus;

      const basicHp = dbData.basicHp || dbData.hp || 100;
      const lvlMultiplier = (1 + 4 * playerSchema.level / 100);
      
      // Расчет HP
      let maxHp = ((playerSchema.endurance * 30) + basicHp) * lvlMultiplier;
      playerSchema.maxHp = parseFloat(maxHp.toFixed(1));
      
      // Если текущее HP не задано или превышает макс, сбрасываем
      if (!playerSchema.hp || playerSchema.hp > playerSchema.maxHp) {
          playerSchema.hp = playerSchema.maxHp;
      }

      // Расчет Атаки
      let mainStat = playerSchema.strength;
      if (playerSchema.class === 'Маг' || playerSchema.class === 'Жрец') mainStat = playerSchema.intelligence;
      if (playerSchema.class === 'Лучник') mainStat = playerSchema.agility;

      playerSchema.attack = ((mainStat * 5) + (bonuses.patkBonus * 15)) * lvlMultiplier;
      playerSchema.attack = parseFloat(playerSchema.attack.toFixed(1));
      
      playerSchema.armor = (dbData.pdef || 0) + bonuses.pdefBonus;
  }

  handleInteract(client, targetId) {
      let npcId = targetId;
      // Если ID пришел как "npc_1", пробуем найти в стейте реальный ID
      if (targetId.toString().startsWith("npc_")) {
           const npc = this.state.npcs.get(targetId);
           if (npc) npcId = npc.id;
      }

      const npcData = DataManager.getNPC(npcId);
      if (!npcData) {
          // console.warn("NPC not found for interaction:", targetId);
          return;
      }

      if (npcData.type && npcData.type !== "" && npcData.type !== "0") {
          client.send("notif", { message: "Это враг! Битва скоро будет доступна.", type: "info" });
      } else {
          const interaction = npcData.interaction || {};
          if (interaction.dialog) {
              this.handleDialog(client, interaction.dialog, npcData.name);
          } else if (interaction.quest) {
              client.send("newQuest", { id: interaction.quest });
          }
      }
  }

  handleDialog(client, dialogId, npcName) {
      const dialog = DataManager.getDialog(dialogId);
      if (!dialog) return;

      if (!this.checkDialogConditions(client, dialog)) {
           client.send("notif", { message: "Условия диалога не выполнены", type: "warning" });
           return;
      }

      const children = DataManager.dialogs
          .filter(d => d.parent == dialog.id)
          .filter(d => this.checkDialogConditions(client, d));

      const response = {
          id: dialog.id,
          title: dialog.title,
          text: dialog.text,
          name: npcName, 
          children: children.map(c => ({ id: c.id, text: c.title }))
      };

      client.send("dialog", response);
  }

  checkDialogConditions(client, dialog) {
      // Здесь можно реализовать проверку квестов, уровня и т.д.
      return true;
  }

  spawnNPCs() {
    let count = 0;
    DataManager.npcs.forEach(npcData => {
        if (count > 100) return; // Ограничение кол-ва

        const npc = new NPC();
        npc.id = npcData.id;
        npc.type = npcData.type || "unknown";
        npc.name = npcData.name || "Unknown";
        npc.hp = npcData.hp || 100;
        npc.maxHp = npcData.maxHp || 100;
        
        // Парсим координаты из "10-20"
        if (npcData.coords && npcData.coords.includes('-')) {
             const parts = npcData.coords.split('-');
             // Конвертируем тайлы в пиксели для спавна
             npc.x = parseInt(parts[0]) * this.tileSize + this.tileSize/2;
             npc.y = parseInt(parts[1]) * this.tileSize + this.tileSize/2;
        } else {
             npc.x = 300; npc.y = 300;
        }

        this.state.npcs.set(`npc_${npcData.id}`, npc);
        count++;
    });
  }
}

module.exports = GameRoom;