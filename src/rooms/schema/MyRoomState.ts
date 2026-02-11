import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

// Класс участника боя (Игрок или Моб)
export class BattleUnit extends Schema {
    @type("string") id: string = "";
    @type("string") name: string = "";
    @type("string") type: string = "player"; // "player" | "mob"
    @type("number") hp: number = 0;
    @type("number") maxHp: number = 0;
    @type("number") level: number = 1;
    @type("number") damage: number = 0; // Для расчетов
    @type("string") avatar: string = ""; // Какой спрайт рисовать
}

// Класс самого боя
export class Battle extends Schema {
    @type("string") id: string = "";
    @type("string") state: string = "start"; // start, player_turn, enemy_turn, win, lose
    @type("number") round: number = 1;
    
    // Участники: "player" -> BattleUnit, "enemy" -> BattleUnit
    @type({ map: BattleUnit }) units = new MapSchema<BattleUnit>();
    
    // Лог боя (кто кого ударил), чтобы показывать на клиенте
    @type(["string"]) logs = new ArraySchema<string>();
}

// Обычный игрок на карте (добавляем ссылку на battleId)
export class Player extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("string") name: string = "";
    @type("number") skin: number = 0;

    // Ссылка на текущий бой (если пустая строка — игрок на карте)
    @type("string") battleId: string = "";

    // Характеристики
    @type("number") hp: number = 100;
    @type("number") maxHp: number = 100;
    @type("number") level: number = 1;
    @type("number") exp: number = 0;
    @type("number") maxExp: number = 100;
    
    // Инвентарь
    @type("string") inventory: string = "[]";

    // Серверные поля
    dbId: number = 0;
    pathQueue: any[] = [];
    
    // Боевые статы (расчетные)
    strength: number = 5;
    agility: number = 5;
    damage: number = 10;
    armor: number = 0;
    speed: number = 200;
}

// Главный стейт
export class MyRoomState extends Schema {
    @type({ map: Player }) players = new MapSchema<Player>();
    // Храним активные бои: ID боя -> Объект боя
    @type({ map: Battle }) battles = new MapSchema<Battle>();
}