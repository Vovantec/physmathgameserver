const Battle = require('../mechanics/Battle');
const DataManager = require('./GameDataManager');
const { NPC } = require('../rooms/schema/GameState'); // Нам нужен класс NPC для создания копий

class BattleManager {
    constructor(room) {
        this.room = room;
        this.battles = new Map(); // id -> Battle
        this.lastId = 0;
    }

    createPvE(client, monsterId) {
        const initiator = this.room.state.players.get(client.sessionId);
        if (!initiator) return;

        // 1. Определяем участников боя (Соло или Группа)
        let battlePlayers = [initiator];
        
        // Если игрок в группе — берем всех членов группы
        if (initiator.partyId) {
            const party = this.room.partyManager.parties.get(initiator.partyId);
            if (party) {
                // Можно добавить проверку дистанции, чтобы в бой вступали только те, кто рядом
                // Пока берем всех живых
                battlePlayers = party.getPlayers().filter(p => p.hp > 0 && !p.battleId);
                
                if (battlePlayers.length === 0) {
                    client.send("notif", { message: "Вся группа мертва или занята", type: "error" });
                    return;
                }
            }
        } else {
            // Соло проверка
            if (initiator.battleId) {
                client.send("notif", { message: "Вы уже в бою!", type: "error" });
                return;
            }
        }

        // 2. Получаем данные монстра
        let npcData;
        if (typeof monsterId === 'string' && monsterId.startsWith('npc_')) {
             const dbId = parseInt(monsterId.split('_')[1]);
             npcData = require('./GameDataManager').getNPC(dbId); // require здесь, чтобы избежать циклических ссылок
        } else {
             npcData = require('./GameDataManager').getNPC(monsterId);
        }

        if (!npcData) {
            client.send("notif", { message: "Монстр не найден", type: "error" });
            return;
        }

        // 3. Создаем монстра (Усиливаем его, если игроков много? Пока нет, как в оригинале)
        const battleMonster = {
            id: npcData.id,
            name: npcData.name,
            level: npcData.level || 1,
            hp: npcData.hp || 100,
            maxHp: npcData.maxHp || 100,
            attack: npcData.attack || 10,
            armor: npcData.armor || 0,
            dodge: npcData.dodge || 0,
            avatar: npcData.avatar,
            elite: npcData.elite || 0
        };

        const battleId = `battle_${++this.lastId}`;
        
        // ВАЖНО: Battle класс уже поддерживает массив игроков (this.players = players)
        // Мы передаем battlePlayers
        const Battle = require('../mechanics/Battle');
        const battle = new Battle(battleId, this.room, battlePlayers, [battleMonster]);
        
        this.battles.set(battleId, battle);
        
        // Привязываем всех игроков к бою
        battlePlayers.forEach(p => p.battleId = battleId);
        
        battle.start();
        console.log(`Battle ${battleId} started: ${battlePlayers.length} players vs ${battleMonster.name}`);
    }

    handleAction(client, action) {
        const player = this.room.state.players.get(client.sessionId);
        if (!player || !player.battleId) return;

        const battle = this.battles.get(player.battleId);
        if (!battle) {
            player.battleId = null; // Очистка, если бой потерян
            return;
        }

        // action: { type: 'attack', targetId: '...' }
        battle.handlePlayerAction(player.id, action.type, action.targetId);
    }

    removeBattle(battleId) {
        const battle = this.battles.get(battleId);
        if (battle) {
            // Очищаем battleId у игроков
            battle.players.forEach(p => p.battleId = null);
            this.battles.delete(battleId);
        }
    }
}

module.exports = BattleManager;