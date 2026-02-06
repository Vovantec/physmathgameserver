import { Room, Client } from "colyseus";
import { MyRoomState, Player } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  // Размер тайла (должен совпадать с клиентом)
  tileSize: number = 64; 

  onCreate (options: any) {
    this.setState(new MyRoomState());

    // --- ОБРАБОТКА ДВИЖЕНИЯ ПО ПУТИ ---
    // Клиент присылает: { path: [[x1, y1], [x2, y2], ...] } в координатах СЕТКИ
    this.onMessage("movePath", (client, message) => {
        const player = this.state.players.get(client.sessionId);
        if (player && message.path && Array.isArray(message.path)) {
            // Конвертируем координаты сетки в пиксели (центр тайла)
            const pixelPath = message.path.map((point: number[]) => ({
                x: point[0] * this.tileSize + this.tileSize / 2,
                y: point[1] * this.tileSize + this.tileSize / 2
            }));

            // Обрезаем первую точку, если она слишком близко к текущей позиции (чтобы не дергало назад)
            if (pixelPath.length > 0) {
                 // Тут можно добавить валидацию (не слишком ли далеко прыжок?)
            }

            // Перезаписываем очередь движения
            player.pathQueue = pixelPath;
        }
    });

    // Обычный move оставим для совместимости или отладки
    this.onMessage("move", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            player.pathQueue = []; // Сброс пути при принудительном движении
            player.x = data.x;
            player.y = data.y;
        }
    });

    // --- ИГРОВОЙ ЦИКЛ (50 FPS) ---
    // Сервер будет считать движение и обновлять x/y, 
    // Colyseus автоматически отправит изменения клиентам.
    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  // Метод вызывается каждые ~20мс
  update(deltaTime: number) {
      // deltaTime приходит в миллисекундах. Конвертируем в секунды для расчетов
      const dtSeconds = deltaTime / 1000;

      this.state.players.forEach(player => {
          this.processPlayerMovement(player, dtSeconds);
      });
  }

  processPlayerMovement(player: Player, dt: number) {
      if (player.pathQueue.length === 0) return;

      const target = player.pathQueue[0]; // Следующая точка {x, y}
      
      // Вычисляем расстояние до цели
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Шаг движения за этот кадр
      const moveStep = player.speed * dt;

      if (distance <= moveStep) {
          // Если дошли до точки (или перешагнули её)
          player.x = target.x;
          player.y = target.y;
          // Удаляем точку из очереди
          player.pathQueue.shift();
      } else {
          // Двигаемся в сторону точки
          // Нормализуем вектор (dx/distance, dy/distance) и умножаем на шаг
          player.x += (dx / distance) * moveStep;
          player.y += (dy / distance) * moveStep;
      }
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    const player = new Player();
    
    // Начальная позиция (например, центр карты)
    player.x = 400;
    player.y = 400;
    player.name = options.name || "Player";
    player.skin = options.skin || 0;

    this.state.players.set(client.sessionId, player);
  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room disposed");
  }
}