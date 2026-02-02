const DataManager = require('../managers/GameDataManager');

class Battle {
    constructor(id, room, players, monsters) {
        this.id = id;
        this.room = room; // Ссылка на комнату для отправки сообщений
        this.players = players; // Массив объектов Player (схемы)
        this.monsters = monsters; // Массив объектов NPC (схемы)
        
        this.finished = false;
        this.turns = []; // Очередь ходов
        
        // Инициализация очереди ходов (как в старом коде: 5 раундов вперед)
        this.initTurns();
    }

    initTurns() {
        this.turns = [];
        const totalUnits = this.players.length + this.monsters.length;
        // Генерируем очередь на 5 кругов вперед
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < totalUnits; j++) {
                this.turns.push(j);
            }
        }
    }

    start() {
        // Уведомляем клиентов о начале боя
        // Формируем данные для клиента (упрощенные)
        const monstersData = this.monsters.map(m => ({
            id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp, type: m.type, avatar: m.avatar
        }));
        
        const playersData = this.players.map(p => ({
            id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp, avatar: p.avatar
        }));

        this.broadcast("battle:start", {
            battleId: this.id,
            monsters: monstersData,
            players: playersData,
            turns: this.turns
        });

        this.processNextTurn();
    }

    broadcast(type, data) {
        // Отправляем сообщение всем игрокам в этом бою
        this.players.forEach(player => {
            const client = this.room.clients.find(c => c.sessionId === player.id);
            if (client) client.send(type, data);
        });
    }

    processNextTurn() {
        if (this.finished) return;

        const currentTurnIndex = this.turns[0];
        const totalPlayers = this.players.length;
        
        // Если ход игрока
        if (currentTurnIndex < totalPlayers) {
            const player = this.players[currentTurnIndex];
            // Ждем команды от игрока (клиент сам знает, что его ход)
            // Можно добавить таймер на авто-пропуск хода
        } else {
            // Ход монстра
            const monsterIndex = currentTurnIndex - totalPlayers;
            const monster = this.monsters[monsterIndex];
            
            if (monster && monster.hp > 0) {
                // Задержка перед атакой монстра (как в оригинале 2000мс)
                this.room.clock.setTimeout(() => {
                    this.monsterAttack(monster);
                }, 2000);
            } else {
                // Если монстр мертв, пропускаем ход
                this.nextTurn();
            }
        }
    }

    nextTurn() {
        if (this.finished) return;
        
        const turn = this.turns.shift();
        this.turns.push(turn);
        
        // Проверяем состояние боя (все ли живы)
        this.checkWinCondition();
        
        if (!this.finished) {
            this.processNextTurn();
        }
    }

    // Обработка действия игрока
    handlePlayerAction(playerId, action, targetId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return;

        // Проверка: сейчас ход этого игрока?
        if (this.turns[0] !== playerIndex) {
            // Можно отправить уведомление "Не твой ход"
            return;
        }

        const player = this.players[playerIndex];
        
        if (action === 'attack') {
            // Ищем цель (пока только монстры)
            // targetId может приходить как "npc_1" или просто ID
            const monster = this.monsters.find(m => `npc_${m.id}` === targetId || m.id == targetId);
            
            if (!monster) {
                this.broadcast("battle:log", { text: "Цель не найдена" });
                return;
            }

            this.performAttack(player, monster);
        }

        this.nextTurn();
    }

    performAttack(attacker, target) {
        // Формулы из index.js
        // Шанс попадания: 90 + accuracy - dodge
        // (Упрощаем: берем базовые 90, так как бонусов пока может не быть)
        const hitChance = 90 + (attacker.accuracy || 0) - (target.dodge || 0);
        const isHit = Math.random() * 100 <= hitChance;

        if (isHit) {
            // Урон: attack * random(0.9, 1.1) * 80 / armor
            const randomMult = (Math.floor(Math.random() * (110 - 90 + 1)) + 90) / 100;
            const targetArmor = target.armor || 10; // Защита от деления на 0
            
            let damage = attacker.attack * randomMult * 80 / targetArmor;
            damage = Math.floor(damage);
            if (damage < 1) damage = 1;

            target.hp -= damage;
            if (target.hp < 0) target.hp = 0;

            this.broadcast("battle:action", {
                type: "damage",
                attackerId: attacker.id || attacker.name, // Player ID or Monster Name
                targetId: target.id || target.name,
                value: damage,
                isCrit: false // Пока без критов
            });

            console.log(`${attacker.name} нанес ${damage} урона по ${target.name}`);
        } else {
            this.broadcast("battle:action", {
                type: "miss",
                attackerId: attacker.id || attacker.name,
                targetId: target.id || target.name
            });
        }
    }

    monsterAttack(monster) {
        if (this.finished) return;

        // Монстр бьет случайного живого игрока
        const livePlayers = this.players.filter(p => p.hp > 0);
        if (livePlayers.length === 0) return; // Все мертвы

        const target = livePlayers[Math.floor(Math.random() * livePlayers.length)];
        
        // Используем ту же логику атаки
        this.performAttack(monster, target);
        
        // Проверяем, не умер ли игрок
        if (target.hp <= 0) {
            this.broadcast("battle:log", { text: `${target.name} пал в бою!` });
        }
        
        this.nextTurn();
    }

    checkWinCondition() {
        // 1. Все монстры мертвы?
        const aliveMonsters = this.monsters.filter(m => m.hp > 0);
        if (aliveMonsters.length === 0) {
            this.finishBattle(true);
            return;
        }

        // 2. Все игроки мертвы?
        const alivePlayers = this.players.filter(p => p.hp > 0);
        if (alivePlayers.length === 0) {
            this.finishBattle(false);
            return;
        }
    }

    // В src/mechanics/Battle.js

    finishBattle(isWin) {
        this.finished = true;
        
        if (isWin) {
            let totalExp = 0;
            let totalMoney = 0;
            const drops = []; // Список выпавших предметов ID

            this.monsters.forEach(m => {
                // 1. Опыт
                const lvlCoef = 1; 
                const eliteCoef = (m.elite || 0) + 1;
                const mLevel = m.level || 1;
                totalExp += (15 * mLevel + 30) * lvlCoef * eliteCoef;

                // 2. Деньги (Формула из index.old.js)
                const money = (0.3 * Math.pow(mLevel, 3) - 6 * Math.sqrt(mLevel) + 40.85 * mLevel - 5.2) * eliteCoef;
                totalMoney += Math.max(0, Math.floor(money));

                // 3. Предметы (Упрощенно: если у моба есть drop_main, кидаем его)
                // В index.old.js это было сложнее, но начнем с малого
                if (m.drop_main && Math.random() < 0.3) { // 30% шанс
                    drops.push(m.drop_main);
                }
            });
            
            // Делим опыт и деньги на группу
            const expPerPlayer = Math.floor(totalExp / this.players.length);
            const moneyPerPlayer = Math.floor(totalMoney / this.players.length);
            
            this.players.forEach(player => {
                // Начисляем опыт (уже есть)
                this.room.addExperience(player, expPerPlayer);
                
                // Начисляем награды через GameRoom (нужно реализовать метод giveReward)
                this.room.giveReward(player, moneyPerPlayer, drops);
            });

            this.broadcast("battle:finish", { 
                winner: "players", 
                exp: expPerPlayer,
                money: moneyPerPlayer,
                drops: drops 
            });
            
            // Уведомляем комнату, что мобы умерли (для респавна)
            this.monsters.forEach(m => {
                this.room.handleMonsterDeath(m.id); // m.id здесь это ID базы, нужно аккуратнее
            });

        } else {
            this.broadcast("battle:finish", { winner: "monsters" });
        }

        this.room.battleManager.removeBattle(this.id);
    }
}

module.exports = Battle;