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
        this.level = 1;
    }
}
schema.defineTypes(Entity, {
    x: "number",
    y: "number",
    hp: "number",
    maxHp: "number",
    name: "string",
    level: "number"
});

class Player extends Entity {
    constructor() {
        super();
        this.class = "warrior";
        this.exp = 0;
        this.maxExp = 100;
        
        this.targetX = 0;
        this.targetY = 0;
        
        // Характеристики
        this.strength = 0;
        this.agility = 0;
        this.endurance = 0;
        this.intelligence = 0;
        
        this.attack = 0;
        this.armor = 0;
        
        // Внешний вид
        this.skin = 0;
        this.avatar = "";

        this.battleId = "";
        this.partyId = "";
    }
}
schema.defineTypes(Player, {
    class: "string",
    exp: "number",
    maxExp: "number",
    targetX: "number",
    targetY: "number",
    
    strength: "number",
    agility: "number",
    endurance: "number",
    intelligence: "number",
    
    attack: "number",
    armor: "number",
    
    skin: "number",
    avatar: "string"
});

class NPC extends Entity {
    constructor() {
        super();
        this.id = 0; 
        this.type = ""; 
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
    npcs: { map: NPC },
    battleId: "string",
    partyId: "string"
});

module.exports = { GameState, Player, NPC };