const colyseus = require('colyseus');
const { GameState, Player, NPC } = require('./schema/GameState');
const axios = require('axios');
const DataManager = require('../managers/GameDataManager');
const path = require('path');
const fs = require('fs');

const API_URL = process.env.API_URL || 'http://web:3000';
const API_KEY = process.env.INTERNAL_API_KEY;

// Константы слотов (из старого index.js)
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

  async onCreate(options) {
    console.log("GameRoom created!");
    this.setState(new GameState());

    // 1. Загрузка карты
    try {
        const mapPath = path.join(__dirname, '../../data/maps.json');
        if (fs.existsSync(mapPath)) {
            const rawMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            this.mapData = rawMap[0];
        } else {
            this.mapData = [];
        }
    } catch (e) {
        this.mapData = [];
    }

    // 2. Спавн NPC
    this.spawnNPCs();

    // ================== ОБРАБОТЧИКИ СООБЩЕНИЙ ==================

    // Перемещение
    this.onMessage("move", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.targetX = data.x;
            player.targetY = data.y;
        }
    });

    // Чат
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

    // Инвентарь: Перемещение предмета
    this.onMessage("inventory:swap", (client, data) => {
        this.handleInventorySwap(client, data.oldPos, data.newPos);
    });

    // Взаимодействие (клик по NPC)
    this.onMessage("interact", (client, data) => {
        const npcKey = data.targetId;
        const npcSchema = this.state.npcs.get(npcKey);
        
        if (npcSchema) {
            const npcData = DataManager.getNPC(npcSchema.id);
            // Если это монстр (type есть и не пустой)
            if (npcData && npcData.type && npcData.type !== "0") {
                this.battleManager.createPvE(client, data.targetId);
            } else {
                // Логика диалогов (которая уже была написана)
                this.handleInteract(client, npcData); 
            }
        }
    });

    // Диалог: Продолжить / Выбрать ответ
    this.onMessage("dialog:continue", (client, data) => {
        this.handleDialog(client, data.dialogId, data.npcName);
    });

    // Инициализация менеджера боев
    this.battleManager = new BattleManager(this);
    this.partyManager = new PartyManager(this);

    // ОБРАБОТЧИК: Действие в бою
    this.onMessage("battle:action", (client, data) => {
        // data = { type: 'attack', targetId: 'npc_1' }
        this.battleManager.handleAction(client, data);
    });

    // Пригласить игрока: { targetSessionId: "..." }
    this.onMessage("party:invite", (client, data) => {
        this.partyManager.handleInvite(client, data.targetSessionId);
    });

    // Принять приглашение: { partyId: "..." }
    this.onMessage("party:accept", (client, data) => {
        this.partyManager.handleAccept(client, data.partyId);
    });

    // Покинуть группу
    this.onMessage("party:leave", (client, data) => {
        this.partyManager.handleLeave(client);
    });

    // АВТОСОХРАНЕНИЕ: Каждые 30 секунд сохраняем всех игроков
    this.setSimulationInterval(() => this.update()); // Если нужно для физики (опционально)
    
    this.clock.setInterval(() => {
        this.clients.forEach(client => {
            this.savePlayerState(client);
        });
    }, 30000); // 30 секунд
  }

  async savePlayerState(client) {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      try {
          await axios.post(`${API_URL}/api/internal/save/character`, {
              userId: client.auth.userId, // Мы сохранили это в onAuth
              level: player.level,
              exp: player.exp,
              hp: player.hp,
              x: Math.floor(player.x),
              y: Math.floor(player.y)
          }, { headers: { 'x-api-secret': API_KEY } });
          
          // console.log(`Saved state for ${player.name}`);
      } catch (e) {
          console.error(`Failed to save state for ${player.name}:`, e.message);
      }
  }

  // Сохранение инвентаря (уже было в заготовках, но актуализируем)
  async savePlayerInventory(client) {
      // client.auth.inventory хранит актуальное состояние (мы обновляем его при swap/add)
      if (!client.auth.inventory) return;

      try {
          // Минимизируем данные перед отправкой (убираем статы предметов, оставляем только ID и pos)
          const inventoryMin = client.auth.inventory.map(item => {
             if (item.coins) return item; // Монеты
             return {
                 id: item.id,
                 pos: item.pos,
                 grade: item.grade,
                 count: item.count || 1
             };
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
      // Инвентарь хранится в client.auth.inventory (мы загрузили его в onAuth)
      // Это массив объектов, не синхронизируемый через State (для экономии трафика),
      // но изменения отправляются клиенту точечно.
      
      const inventory = client.auth.inventory;
      const oldPosItem = inventory.find(o => o.pos == oldPos);
      const newPosItem = inventory.find(o => o.pos == newPos);
      const player = this.state.players.get(client.sessionId);

      if (!oldPosItem) return; // Предмета нет

      // 1. Проверка типов слотов (Logic from index.js)
      // Если надеваем предмет (слоты 0-14)
      if (INVENTORY_TYPE_SLOTS.hasOwnProperty(newPos)) {
          // Проверяем тип предмета
          const allowedTypes = INVENTORY_TYPE_SLOTS[newPos];
          if (!allowedTypes.includes(oldPosItem.type)) {
              client.send("notif", { message: `Слот не подходит для "${oldPosItem.name}"`, type: "error" });
              return;
          }
          // Проверяем класс (если есть ограничение)
          if (oldPosItem.class && !oldPosItem.class.includes(player.class)) {
             client.send("notif", { message: `Предмет не для вашего класса`, type: "error" });
             return;
          }
      }

      // Если снимаем предмет (из 0-14 в сумку) или меняем местами
      if (INVENTORY_TYPE_SLOTS.hasOwnProperty(oldPos) && newPosItem) {
           // Если меняем местами надетый предмет с предметом в сумке,
           // нужно проверить, подходит ли предмет из сумки в этот слот
           const allowedTypes = INVENTORY_TYPE_SLOTS[oldPos];
           if (!allowedTypes.includes(newPosItem.type)) {
               client.send("notif", { message: `Нельзя заменить: типы не совпадают`, type: "error" });
               return;
           }
      }

      // 2. Логика свапа
      if (newPosItem) {
          // Обмен позициями
          oldPosItem.pos = newPos;
          newPosItem.pos = oldPos;
      } else {
          // Перенос в пустой слот
          oldPosItem.pos = newPos;
      }

      // 3. Сохранение в БД (Асинхронно)
      this.savePlayerInventory(client);

      // 4. Пересчет характеристик
      // Если затронуты слоты экипировки (0-14), статы могли измениться
      if (oldPos <= 14 || newPos <= 14) {
          this.calcAttributes(player, client.auth.dbData, inventory);
      }

      // 5. Отправка клиенту обновленного инвентаря
      client.send("inventory:update", inventory);
  }

  async saveInventory(client) {
      try {
          const inventoryMin = client.auth.inventory.map(item => ({
              id: item.id,
              pos: item.pos,
              grade: item.grade,
              count: item.count || 1
              // Мы сохраняем только ID и мету, статы берутся из базы предметов при загрузке
          }));

          // Отправляем на сайт для сохранения в БД
          await axios.post(`${API_URL}/api/internal/inventory/save`, {
              userId: client.auth.userId,
              inventory: JSON.stringify(inventoryMin)
          }, { headers: { 'x-api-secret': API_KEY } });
          
      } catch (e) {
          console.error("Ошибка сохранения инвентаря:", e.message);
      }
  }

  // ================== ЛОГИКА ДИАЛОГОВ И NPC ==================

  handleInteract(client, targetId) {
      // targetId приходит в формате "npc_123" или просто ID
      const npcKey = targetId; 
      const npcSchema = this.state.npcs.get(npcKey);
      
      if (!npcSchema) return;

      // Получаем полные данные NPC из DataManager по ID
      const npcData = DataManager.getNPC(npcSchema.id);
      if (!npcData) return;

      // Логика из index.js: interactNPC
      if (npcData.type && npcData.type !== "" && npcData.type !== "0") {
          // Это МОНСТР -> Начинаем бой
          // TODO: Реализовать startFight(client, npcData.id)
          client.send("notif", { message: "Боевая система в разработке", type: "info" });
      } else {
          // Это NPC -> Проверяем interaction
          const interaction = npcData.interaction || {};
          
          if (interaction.dialog) {
              this.handleDialog(client, interaction.dialog, npcData.name);
          } else if (interaction.quest) {
              // TODO: quest logic
              client.send("newQuest", { id: interaction.quest });
          }
      }
  }

  handleDialog(client, dialogId, npcName) {
      const dialog = DataManager.getDialog(dialogId);
      if (!dialog) {
          client.send("errDialog", `Диалог ${dialogId} не найден`);
          return;
      }

      // Проверка условий (Conditions)
      if (!this.checkDialogConditions(client, dialog)) {
           client.send("notif", { message: "Условия диалога не выполнены", type: "warning" });
           return;
      }

      // Ищем варианты ответов (Children)
      // В DataManager.dialogs плоский список, ищем тех, у кого parent == dialog.id
      const children = DataManager.dialogs
          .filter(d => d.parent == dialog.id)
          .filter(d => this.checkDialogConditions(client, d)); // Показываем только доступные ответы

      // Формируем объект для отправки
      const response = {
          id: dialog.id,
          title: dialog.title,
          text: dialog.text,
          name: npcName, // Имя говорящего
          children: children.map(c => ({
              id: c.id,
              text: c.title // В кнопках обычно показывается title ответа
          }))
      };

      client.send("dialog", response);
  }

  checkDialogConditions(client, dialog) {
      if (!dialog.conditions) return true;
      // Пример парсинга условий из index.js
      // conditions: { "minLevel": 5, "questFinished": 10 }
      
      /* Реализация условий (пример)
      const cond = dialog.conditions;
      const player = this.state.players.get(client.sessionId);

      if (cond.minLevel && player.level < cond.minLevel) return false;
      if (cond.class && player.class !== cond.class) return false;
      */
     
      return true; // Пока заглушка
  }

  // Метод для Battle.js: Начисление опыта
  addExperience(player, amount) {
      const expNext = 40 * Math.pow(player.level, 2) + 360 * player.level;
      
      player.exp += amount;
      
      // Level Up
      if (player.exp >= expNext) {
          player.exp -= expNext;
          player.level += 1;
          
          // Полный пересчет статов с новым уровнем
          // Нам нужно найти client для этого игрока, чтобы получить инвентарь из auth
          const client = this.clients.find(c => c.sessionId === player.id);
          if (client) {
              client.send("notif", { message: `Новый уровень: ${player.level}!`, type: "success" });
              this.calcAttributes(player, client.auth.dbData, client.auth.inventory);

              this.savePlayerState(client);
          }
      } else {
          const client = this.clients.find(c => c.sessionId === player.id);
          if (client) {
             client.send("notif", { message: `+${amount} опыта`, type: "info" });
          }
      }
  }

  // Выносим логику диалогов в отдельный метод, чтобы не путать с боем
  handleDialogInteract(client, npcData) {
      const interaction = npcData.interaction || {};
      if (interaction.dialog) {
          this.handleDialog(client, interaction.dialog, npcData.name);
      } else if (interaction.quest) {
          client.send("newQuest", { id: interaction.quest });
      }
  }

  // ================== СИСТЕМНЫЕ МЕТОДЫ ==================

  spawnNPCs() {
    let count = 0;
    DataManager.npcs.forEach(npcData => {
        if (count > 50) return; 

        const npc = new NPC();
        npc.id = npcData.id;
        npc.type = npcData.type || "unknown";
        npc.name = npcData.name || "Unknown";
        npc.hp = npcData.hp || 100;
        npc.maxHp = npcData.maxHp || 100;
        
        if (npcData.coords && npcData.coords.includes('-')) {
             const parts = npcData.coords.split('-');
             npc.x = parseInt(parts[0]);
             npc.y = parseInt(parts[1]);
        } else {
             npc.x = 200 + (count * 50);
             npc.y = 300;
        }

        this.state.npcs.set(`npc_${npcData.id}`, npc); // ID в стейте: npc_1, npc_2...
        count++;
    });
  }

  async onAuth(client, options) {
    if (!options.token) throw new colyseus.ServerError(400, "No token");

    try {
        const verifyRes = await axios.post(`${API_URL}/api/internal/verify-token`, 
            { token: options.token },
            { headers: { 'x-api-secret': API_KEY } }
        );
        
        if (!verifyRes.data.valid) throw new colyseus.ServerError(401, "Invalid Token");
        const userId = verifyRes.data.userId;

        const charRes = await axios.get(`${API_URL}/api/internal/character`, {
            params: { userId: userId },
            headers: { 'x-api-secret': API_KEY }
        });

        const charData = charRes.data.character;
        
        let inventory = [];
        try {
             const rawInv = JSON.parse(charData.inventory || "[]");
             inventory = rawInv.map(slotItem => {
                 if (slotItem.coins) return slotItem;
                 const baseItem = DataManager.getItem(slotItem.id);
                 return baseItem ? { ...baseItem, ...slotItem } : slotItem;
             });
        } catch(e) {}

        return { 
            userId: userId, // Сохраняем ID юзера для API запросов
            dbData: charData,
            inventory: inventory
        };

    } catch (e) {
        console.error("Auth/Load failed:", e.message);
        throw new colyseus.ServerError(500, "Auth error");
    }
  }

  onJoin(client, options) {
    const data = client.auth.dbData;
    const inventory = client.auth.inventory;

    const player = new Player();
    player.id = client.sessionId;
    player.name = data.name;
    player.level = data.level;
    player.class = data.class;
    player.exp = data.exp || 0;
    
    const classessNameRu = ['Воин', 'Рыцарь', 'Лучник', 'Маг', 'Жрец'];
    player.skin = classessNameRu.indexOf(data.class);
    if (player.skin === -1) player.skin = 0;
    player.avatar = `images/gui/resource/Textures/Unit Frames/Main/Avatar/${player.skin}.png`;

    if (data.arrMap) {
        const coords = data.arrMap.split('-');
        player.x = parseInt(coords[0]) || 100;
        player.y = parseInt(coords[1]) || 100;
    } else {
        player.x = 100;
        player.y = 100;
    }
    player.targetX = player.x;
    player.targetY = player.y;

    this.calcAttributes(player, data, inventory);

    this.state.players.set(client.sessionId, player);
    
    // Отправляем инвентарь только этому игроку
    client.send("inventory:update", inventory);
  }

  calcAttributes(playerSchema, dbData, inventory) {
      const needAttr = [
        'strength', 'agility', 'endurance', 'intelligence', 
        'patk', 'matk', 'pdef', 'mdef', 
        'pcritchance', 'pcritmult', 'mcritchance', 'mcritmult', 
        'evasion', 'accuracy', 
        'hp', 'mp', 'hpregen', 'mpregen', 
        'agression', 'block'
      ];

      const bonuses = {};
      needAttr.forEach(attr => bonuses[attr + 'Bonus'] = 0);

      inventory.forEach(item => {
          if (!item || item.coins) return;
          const pos = parseInt(item.pos);
          if (isNaN(pos) || pos > 14) return;

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
      const hpBonusMultiplier = (1 + bonuses.hpregenBonus / 100);
      
      let maxHp = ((playerSchema.endurance * 30) + basicHp) * lvlMultiplier * hpBonusMultiplier;
      playerSchema.maxHp = parseFloat(maxHp.toFixed(1));
      playerSchema.hp = playerSchema.maxHp; 

      let mainStat = 0;
      const ATTACK_GLOBAL_BONUS = 0; 
      
      if (playerSchema.class === 'Маг' || playerSchema.class === 'Жрец') {
          mainStat = playerSchema.intelligence;
          playerSchema.attack = ((mainStat * 5) + (bonuses.matkBonus * 15)) * lvlMultiplier * (1 + ATTACK_GLOBAL_BONUS / 100);
      } else if (playerSchema.class === 'Лучник') {
          mainStat = playerSchema.agility;
          playerSchema.attack = ((mainStat * 5) + (bonuses.patkBonus * 15)) * lvlMultiplier * (1 + ATTACK_GLOBAL_BONUS / 100);
      } else {
          mainStat = playerSchema.strength;
          playerSchema.attack = ((mainStat * 5) + (bonuses.patkBonus * 15)) * lvlMultiplier * (1 + ATTACK_GLOBAL_BONUS / 100);
      }

      playerSchema.attack = parseFloat(playerSchema.attack.toFixed(1));
      playerSchema.armor = (dbData.pdef || 0) + bonuses.pdefBonus;
  }

  async onLeave(client) {
    console.log(`Client left: ${client.sessionId}`);
    
    // 1. Удаляем из группы
    this.partyManager.handleLeave(client);
    
    // 2. Сохраняем прогресс ПЕРЕД удалением
    // Используем Promise.all, чтобы сохранить и статы, и инвентарь параллельно
    await Promise.all([
        this.savePlayerState(client),
        this.savePlayerInventory(client)
    ]);

    // 3. Удаляем игрока из стейта
    this.state.players.delete(client.sessionId);
  }
}

module.exports = GameRoom;