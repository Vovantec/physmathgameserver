import { Battle, BattleUnit, Player } from "../rooms/schema/MyRoomState";
import { ArraySchema } from "@colyseus/schema";

export class BattleLogic {
    
    static createBattle(battleId: string, player: Player, mobConfig: any): Battle {
        const battle = new Battle();
        battle.id = battleId;
        battle.state = "player_turn";
        battle.round = 1;

        // 1. Создаем копию игрока для боя
        const pUnit = new BattleUnit();
        pUnit.id = clientSessionIdToBattleId(player); // Вспомогательная логика
        pUnit.name = player.name;
        pUnit.type = "player";
        pUnit.hp = player.hp;
        pUnit.maxHp = player.maxHp;
        pUnit.damage = player.damage; 
        pUnit.level = player.level;
        battle.units.set("player", pUnit);

        // 2. Создаем моба
        const mUnit = new BattleUnit();
        mUnit.id = "mob_1";
        mUnit.name = mobConfig.name || "Monster";
        mUnit.type = "mob";
        mUnit.hp = mobConfig.hp || 50;
        mUnit.maxHp = mobConfig.hp || 50;
        mUnit.damage = mobConfig.damage || 5;
        mUnit.avatar = mobConfig.type || "slime";
        battle.units.set("enemy", mUnit);

        battle.logs.push(`Battle started against ${mUnit.name}!`);
        return battle;
    }

    static handlePlayerAction(battle: Battle, action: string): { finished: boolean, winner?: string } {
        if (battle.state !== "player_turn") return { finished: false };

        const player = battle.units.get("player");
        const enemy = battle.units.get("enemy");
        if (!player || !enemy) return { finished: true }; // Ошибка

        if (action === "attack") {
            // Расчет урона (как в Legacy: damage +/- 10%)
            const dmg = Math.floor(player.damage * (0.9 + Math.random() * 0.2));
            enemy.hp -= dmg;
            battle.logs.push(`You hit ${enemy.name} for ${dmg} dmg.`);
            
            if (enemy.hp <= 0) {
                enemy.hp = 0;
                battle.state = "win";
                battle.logs.push(`${enemy.name} died!`);
                return { finished: true, winner: "player" };
            }
        } else if (action === "heal") {
             // Пример зелья/скилла
             const heal = Math.floor(player.maxHp * 0.2);
             player.hp = Math.min(player.maxHp, player.hp + heal);
             battle.logs.push(`You healed for ${heal} HP.`);
        } else if (action === "flee") {
            battle.state = "lose"; // Или просто выход
            return { finished: true, winner: "enemy" }; // Побег = поражение (нет награды)
        }

        // Переход хода
        battle.state = "enemy_turn";
        return { finished: false };
    }

    static handleEnemyTurn(battle: Battle): { finished: boolean, winner?: string } {
        if (battle.state !== "enemy_turn") return { finished: false };

        const player = battle.units.get("player");
        const enemy = battle.units.get("enemy");
        if (!player || !enemy) return { finished: true };

        // Простой ИИ: просто бьет
        const dmg = Math.floor(enemy.damage * (0.8 + Math.random() * 0.4));
        player.hp -= dmg;
        battle.logs.push(`${enemy.name} hits you for ${dmg} dmg.`);

        if (player.hp <= 0) {
            player.hp = 0;
            battle.state = "lose";
            battle.logs.push(`You were defeated...`);
            return { finished: true, winner: "enemy" };
        }

        battle.round++;
        battle.state = "player_turn";
        return { finished: false };
    }
}

function clientSessionIdToBattleId(p: Player) { return "p1"; } // Заглушка