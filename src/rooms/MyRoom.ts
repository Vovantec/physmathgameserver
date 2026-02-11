import { Room, Client } from "colyseus";
import { MyRoomState, Player } from "./schema/MyRoomState";
import axios from "axios";

// Импортируем менеджер статических данных
const GameDataManager = require("../managers/GameDataManager");

const API_URL = process.env.API_URL || 'http://web:3000';
const API_KEY = process.env.INTERNAL_API_KEY;

export class MyRoom extends Room<MyRoomState> {
  tileSize: number = 64; 

  onCreate (options: any) {
    this.setState(new MyRoomState());

    // --- ДВИЖЕНИЕ ---
    this.onMessage("movePath", (client, message) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !message.path || !Array.isArray(message.path)) return;

        // 1. Конвертация координат сетки (Grid) в пиксели (World)
        const pixelPath = message.path.map((point: number[]) => ({
            x: point[0] * this.tileSize + this.tileSize / 2,
            y: point[1] * this.tileSize + this.tileSize / 2
        }));

        // 2. Валидация прыжка (анти-чит / анти-лаг)
        if (pixelPath.length > 0) {
            const dist = Math.hypot(pixelPath[0].x - player.x, pixelPath[0].y - player.y);
            // Если прыжок больше 3 тайлов, игнорируем
            if (dist > this.tileSize * 3) {
                console.warn(`[Cheat] Player ${player.name} warp distance: ${dist}`);
                return; 
            }
        }

        player.pathQueue = pixelPath;
        
        // Сохраняем позицию при каждом изменении пути (можно реже)
        this.saveCharacterPosition(player);
    });

    // --- ИНВЕНТАРЬ ---
    this.onMessage("requestInventory", (client) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            try {
                const items = JSON.parse(player.inventory);
                client.send("inventory", items);
            } catch (e) {
                client.send("inventory", []);
            }
        }
    });

    this.onMessage("inventorySwap", async (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        const { from, to } = data;
        try {
            let items = JSON.parse(player.inventory || "[]");
            const itemFrom = items.find((i: any) => i.pos === from);
            const itemTo = items.find((i: any) => i.pos === to);

            if (itemFrom) itemFrom.pos = to;
            if (itemTo) itemTo.pos = from;

            player.inventory = JSON.stringify(items);
            client.send("inventory", items);
            
            // Сохраняем инвентарь (можно через общий saveCharacterFull)
            await this.saveInventoryToDB(player.dbId, items);
        } catch (e) {
            console.error("Inventory swap error:", e);
        }
    });

    // --- NPC ---
    this.onMessage("npcInteract", (client, data) => {
        const npcId = data.id; 
        client.send("dialog", {
            npcName: `NPC ${npcId}`,
            text: "Приветствую! (Тестовый диалог)",
            options: [{ id: -1, text: "Закрыть" }]
        });
    });

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
      
      // Защита от полета в космос
      if (Math.abs(target.x) > 50000 || Math.abs(target.y) > 50000) {
          player.pathQueue = [];
          return;
      }

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

  // --- ЖИЗНЕННЫЙ ЦИКЛ ---

  async onJoin (client: Client, options: any) {
    console.log(`Client ${client.sessionId} joining...`);
    const token = options.token; 
    
    if (!token) {
        const player = new Player();
        player.x = 400; player.y = 400; player.name = "Guest";
        this.state.players.set(client.sessionId, player);
        return;
    }

    try {
        const response = await axios.get(`${API_URL}/api/internal/character`, {
            params: { token },
            headers: { 'x-api-secret': API_KEY }
        });

        const charData = response.data.character;
        if (!charData) throw new Error("Character data is null");

        const player = new Player();
        player.dbId = charData.id;
        player.name = charData.name || "Unknown";
        player.skin = 0;
        
        // === ЛОГИКА ВОССТАНОВЛЕНИЯ КООРДИНАТ ===
        let spawnX = 400;
        let spawnY = 400;

        if (charData.arrMap && typeof charData.arrMap === 'string') {
             const parts = charData.arrMap.split('-');
             if (parts.length === 2) {
                 const gx = parseInt(parts[0]);
                 const gy = parseInt(parts[1]);
                 
                 // ВАЖНО: Если координаты > 1000 (например 1888), значит это были пиксели.
                 // Сбрасываем их, чтобы персонаж не улетел в космос.
                 if (!isNaN(gx) && !isNaN(gy) && Math.abs(gx) < 1000 && Math.abs(gy) < 1000) {
                     spawnX = gx * this.tileSize;
                     spawnY = gy * this.tileSize;
                 } else {
                     console.warn(`[FIX] Detected corrupted coords ${gx}-${gy} for ${player.name}. Resetting to spawn.`);
                 }
             }
        }

        player.x = spawnX;
        player.y = spawnY;
        // ==========================================

        player.inventory = charData.inventory || "[]"; 
        player.hp = charData.hp || 100;
        player.maxHp = charData.maxHp || 100;
        player.speed = 200;

        this.state.players.set(client.sessionId, player);
        console.log(`Player ${player.name} loaded at ${player.x}:${player.y}`);
        
        // Сразу сохраняем "исправленные" координаты, если они были битыми
        if (spawnX === 400 && spawnY === 400) {
            this.saveCharacterPosition(player);
        }

        client.send("inventory", JSON.parse(player.inventory));

    } catch (e) {
        console.error("Auth/Load failed:", e.message);
        client.leave(4002, "Failed to load character");
    }
  }

  async onLeave (client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
        await this.saveCharacterFull(player);
        this.state.players.delete(client.sessionId);
    }
  }

  // --- СОХРАНЕНИЕ ---

  async saveCharacterPosition(player: Player) {
      if (!player.dbId) return;
      
      // Конвертируем ПИКСЕЛИ -> СЕТКУ
      const gx = Math.floor(player.x / this.tileSize);
      const gy = Math.floor(player.y / this.tileSize);
      
      // Доп. защита от сохранения мусора
      if (Math.abs(gx) > 2000) return;

      const arrMap = `${gx}-${gy}`;

      try {
          // Отправляем arrMap и characterId. API теперь это поддерживает.
          await axios.post(`${API_URL}/api/internal/save/character`, {
              characterId: player.dbId,
              arrMap: arrMap
          }, { headers: { 'x-api-secret': API_KEY } });
      } catch (e) {}
  }

  async saveCharacterFull(player: Player) {
      if (!player.dbId) return;
      
      const gx = Math.floor(player.x / this.tileSize);
      const gy = Math.floor(player.y / this.tileSize);
      
      // Защита
      if (Math.abs(gx) > 2000) return;

      try {
          await axios.post(`${API_URL}/api/internal/save/character`, {
              characterId: player.dbId,
              arrMap: `${gx}-${gy}`,
              inventory: player.inventory,
              hp: player.hp
          }, { headers: { 'x-api-secret': API_KEY } });
      } catch (e) {
          console.error(`Failed to full save ${player.name}:`, e.message);
      }
  }

  async saveInventoryToDB(charId: number, items: any[]) {
      if (!charId) return;
      try {
          // Используем основной save метод, так как он теперь универсален
           await axios.post(`${API_URL}/api/internal/save/character`, {
              characterId: charId,
              inventory: JSON.stringify(items)
          }, { headers: { 'x-api-secret': API_KEY } });
      } catch (e) { console.error("Inv save err", e.message); }
  }

  onDispose() {
    console.log("room disposed");
  }
}