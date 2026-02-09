import { Room, Client } from "colyseus";
import { MyRoomState, Player } from "./schema/MyRoomState";
import axios from "axios";

// Импортируем менеджер статических данных (NPC, Предметы, Диалоги)
const GameDataManager = require("../managers/GameDataManager");

// Конфигурация API
const API_URL = process.env.API_URL || 'http://web:3000';
const API_KEY = process.env.INTERNAL_API_KEY; // Ключ для защиты внутренних ручек

export class MyRoom extends Room<MyRoomState> {
  tileSize: number = 64; 

  onCreate (options: any) {
    this.setState(new MyRoomState());

    // ---------------------------------------------------------
    // 1. ДВИЖЕНИЕ (С валидацией и сохранением)
    // ---------------------------------------------------------
    this.onMessage("movePath", (client, message) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !message.path || !Array.isArray(message.path)) return;

        // Конвертация координат сетки в пиксели
        const pixelPath = message.path.map((point: number[]) => ({
            x: point[0] * this.tileSize + this.tileSize / 2,
            y: point[1] * this.tileSize + this.tileSize / 2
        }));

        // Валидация: проверяем, не слишком ли далеко первая точка от игрока
        if (pixelPath.length > 0) {
            const dist = Math.hypot(pixelPath[0].x - player.x, pixelPath[0].y - player.y);
            // Если прыжок больше 2 тайлов — чит или лаг, игнорируем или телепортируем назад
            if (dist > this.tileSize * 3) {
                console.warn(`Player ${player.name} tried to jump too far: ${dist}`);
                return; 
            }
        }

        player.pathQueue = pixelPath;
        
        // Сохраняем позицию "лениво" (не на каждый шаг, а при смене пути)
        // Можно вынести в onLeave, если не боитесь падений сервера
        this.saveCharacterPosition(player);
    });

    // ---------------------------------------------------------
    // 2. ИНВЕНТАРЬ
    // ---------------------------------------------------------
    
    // Запрос инвентаря (если клиент просит принудительно)
    this.onMessage("requestInventory", (client) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            // Отправляем JSON инвентаря клиенту
            // player.inventory хранится как JSON-строка в стейте, если вы так настроили схему
            // Либо парсим и шлем объект
            try {
                const items = JSON.parse(player.inventory);
                client.send("inventory", items);
            } catch (e) {
                client.send("inventory", []);
            }
        }
    });

    // Перемещение предметов (Swap)
    this.onMessage("inventorySwap", async (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        const { from, to } = data;
        
        try {
            let items = JSON.parse(player.inventory || "[]");
            
            // Находим предметы
            const itemFrom = items.find((i: any) => i.pos === from);
            const itemTo = items.find((i: any) => i.pos === to);

            // Логика перестановки
            if (itemFrom) itemFrom.pos = to;
            if (itemTo) itemTo.pos = from;

            // Обновляем стейт комнаты
            player.inventory = JSON.stringify(items);
            
            // Отправляем подтверждение клиенту
            client.send("inventory", items);

            // Сохраняем в БД асинхронно
            await this.saveInventoryToDB(player.dbId, items);

        } catch (e) {
            console.error("Inventory swap error:", e);
        }
    });

    // ---------------------------------------------------------
    // 3. NPC И ДИАЛОГИ
    // ---------------------------------------------------------
    
    this.onMessage("npcInteract", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        const npcId = data.id; // Например "npc_123" или просто ID из базы

        if (!player) return;

        // 1. Проверяем расстояние (чтобы не говорили через всю карту)
        // Предполагаем, что у нас есть список NPC в GameDataManager или в стейте комнаты
        // Для упрощения считаем, что клиент прислал координаты NPC или мы их знаем
        // (В идеале NPC должны быть в this.state.npcs)

        // 2. Получаем данные NPC
        // npcId может быть "npc_X_Y" или ID из базы "3122"
        // Парсим ID, если нужно
        const realNpcId = npcId.split('_')[0] === 'npc' ? /* логика извлечения */ 0 : parseInt(npcId);

        // Ищем NPC в загруженных данных
        // ВАЖНО: GameDataManager.getNPC ищет по ID модели (например, тип "Стражник"), 
        // а не по уникальному ID экземпляра на карте.
        // Здесь нужна ваша логика: какой диалог у этого NPC?
        // Допустим, мы берем дефолтный диалог из конфига NPC.
        
        // Заглушка: ищем NPC по ID типа (предположим клиент шлет typeID)
        // В реальном проекте вы должны знать, какой NPC стоит в координатах.
        
        const npcData = GameDataManager.getNPC(realNpcId) || { name: "Unknown", interaction: { dialog: 1 } };
        
        if (npcData && npcData.interaction && npcData.interaction.dialog) {
            const dialogId = npcData.interaction.dialog;
            const dialog = GameDataManager.getDialog(dialogId);
            
            if (dialog) {
                // Формируем ответ для клиента
                client.send("dialog", {
                    npcName: npcData.name,
                    text: dialog.text,
                    // Преобразуем условия/ответы, если нужно
                    options: [
                        { id: 1, text: "Привет!" }, // Это нужно брать из `dialog.answers` или связанной таблицы
                        { id: -1, text: "Уйти" }
                    ]
                });
            }
        } else {
             // Тестовый ответ, если данных нет
             client.send("dialog", {
                npcName: `NPC ${npcId}`,
                text: "Здравствуй, путник. (Диалог не настроен)",
                options: [{ id: -1, text: "Закрыть" }]
             });
        }
    });

    // Игровой цикл
    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  update(deltaTime: number) {
      const dtSeconds = deltaTime / 1000;
      this.state.players.forEach(player => {
          this.processPlayerMovement(player, dtSeconds);
      });
  }

  processPlayerMovement(player: Player, dt: number) {
      if (player.pathQueue.length === 0) return;
      const target = player.pathQueue[0];
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const moveStep = player.speed * dt;

      if (distance <= moveStep) {
          player.x = target.x;
          player.y = target.y;
          player.pathQueue.shift();
      } else {
          player.x += (dx / distance) * moveStep;
          player.y += (dy / distance) * moveStep;
      }
  }

  // ---------------------------------------------------------
  // ЖИЗНЕННЫЙ ЦИКЛ КЛИЕНТА
  // ---------------------------------------------------------

  async onJoin (client: Client, options: any) {
    console.log(`Client ${client.sessionId} joining...`);

    // 1. Авторизация через API
    // Клиент должен прислать токен или userId
    const token = options.token; 
    
    if (!token) {
        // Для тестов разрешаем вход без токена, но лучше выкидывать
        // client.leave(4001, "Auth failed"); 
        console.warn("No token provided, using dummy player");
        const player = new Player();
        player.x = 400; player.y = 400; player.name = "Guest";
        this.state.players.set(client.sessionId, player);
        return;
    }

    try {
        // 2. Загрузка данных персонажа из Web API
        // Предполагаем, что есть эндпоинт, который по токену возвращает Character + User data
        const response = await axios.get(`${API_URL}/api/internal/character`, {
            params: { token }, // Или headers Authorization
            headers: { 'x-api-secret': API_KEY }
        });

        const charData = response.data; // Ожидаем формат Prisma Character

        // 3. Создаем игрока в стейте
        const player = new Player();
        player.dbId = charData.id; // ID в базе (нужно добавить поле в схему Player!)
        player.name = charData.name;
        player.skin = 0; // Можно брать из charData.class
        
        // Координаты
        if (charData.arrMap) {
             const [gx, gy] = charData.arrMap.split('-').map(Number);
             player.x = gx * this.tileSize; // Если храним тайлы
             player.y = gy * this.tileSize;
        } else {
             player.x = 400; player.y = 400;
        }

        // Инвентарь
        player.inventory = charData.inventory || "[]"; 
        
        // Характеристики
        player.hp = charData.hp;
        player.maxHp = charData.maxHp;
        player.speed = 200; // Можно считать от ловкости (charData.agility)

        this.state.players.set(client.sessionId, player);
        console.log(`Player ${player.name} loaded from DB.`);

        // Отправляем инвентарь сразу после входа
        client.send("inventory", JSON.parse(player.inventory));

    } catch (e) {
        console.error("Auth/Load failed:", e.message);
        client.leave(4002, "Failed to load character");
    }
  }

  async onLeave (client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
        console.log(`${player.name} left. Saving data...`);
        await this.saveCharacterFull(player);
        this.state.players.delete(client.sessionId);
    }
  }

  // ---------------------------------------------------------
  // HELPERS (API Calls)
  // ---------------------------------------------------------

  async saveInventoryToDB(charId: number, items: any[]) {
      if (!charId) return;
      try {
          await axios.post(`${API_URL}/api/internal/save/inventory`, {
              characterId: charId,
              inventory: JSON.stringify(items)
          }, {
              headers: { 'x-api-secret': API_KEY }
          });
      } catch (e) {
          console.error("Failed to save inventory:", e.message);
      }
  }

  async saveCharacterPosition(player: Player) {
      if (!player.dbId) return;
      // Конвертируем пиксели обратно в "тайл-тайл" для формата базы "10-5"
      const gx = Math.floor(player.x / this.tileSize);
      const gy = Math.floor(player.y / this.tileSize);
      const arrMap = `${gx}-${gy}`;

      try {
          // Используем облегченный эндпоинт или общий save
          await axios.post(`${API_URL}/api/internal/save/character`, {
              characterId: player.dbId,
              arrMap: arrMap
          }, {
            headers: { 'x-api-secret': API_KEY }
          });
      } catch (e) {
          // Ошибки сохранения позиции не критичны, можно не спамить логами
      }
  }

  async saveCharacterFull(player: Player) {
      if (!player.dbId) return;
      const gx = Math.floor(player.x / this.tileSize);
      const gy = Math.floor(player.y / this.tileSize);
      
      try {
          await axios.post(`${API_URL}/api/internal/save/character`, {
              characterId: player.dbId,
              arrMap: `${gx}-${gy}`,
              inventory: player.inventory,
              hp: player.hp
          }, {
            headers: { 'x-api-secret': API_KEY }
          });
          console.log(`Saved ${player.name}`);
      } catch (e) {
          console.error(`Failed to full save ${player.name}:`, e.message);
      }
  }

  onDispose() {
    console.log("room disposed");
  }
}