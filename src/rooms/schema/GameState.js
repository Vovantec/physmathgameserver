const schema = require('@colyseus/schema');
const Schema = schema.Schema;
const MapSchema = schema.MapSchema;

// Сущность (общая для Игрока и NPC)
class Entity extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.name = "";
    }
}
schema.defineTypes(Entity, {
    x: "number",
    y: "number",
    hp: "number",
    maxHp: "number",
    name: "string"
});

class Player extends Entity {
    constructor() {
        super();
        this.class = "warrior";
        this.points = 0;
        // Путь для движения (массив координат)
        // В Colyseus лучше не синхронизировать весь путь, а только цель,
        // но для плавности оставим координаты
        this.targetX = 0;
        this.targetY = 0;
    }
}
schema.defineTypes(Player, {
    class: "string",
    points: "number",
    targetX: "number",
    targetY: "number"
});

class NPC extends Entity {
    constructor() {
        super();
        this.id = 0; // ID из базы
        this.type = ""; // Тип моба
    }
}
schema.defineTypes(NPC, {
    id: "number",
    type: "string"
});

class GameState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.npcs = new MapSchema();
    }
}
schema.defineTypes(GameState, {
    players: { map: Player },
    npcs: { map: NPC }
});

module.exports = { GameState, Player, NPC };