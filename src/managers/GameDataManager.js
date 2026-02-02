const axios = require('axios');

// Конфигурация
const API_URL = process.env.API_URL || 'http://web:3000'; // Адрес контейнера с сайтом
const API_KEY = process.env.INTERNAL_API_KEY; // Тот же ключ, что и в .env сайта

class GameDataManager {
    constructor() {
        // Локальный кэш данных
        this.items = [];
        this.npcs = [];
        this.dialogs = [];
        this.quests = [];
        this.isLoaded = false;
    }

    /**
     * Загружает все статические данные с Web API при старте сервера
     */
    async loadAll() {
        console.log(`📡 Connecting to Web API: ${API_URL}...`);
        
        try {
            const response = await axios.get(`${API_URL}/api/internal/gamedata`, {
                headers: { 'x-api-secret': API_KEY }
            });

            const data = response.data;

            // Обработка и сохранение в кэш
            this.items = data.items || [];
            this.dialogs = this._processDialogs(data.dialogs || []);
            this.npcs = this._processNPCs(data.npcs || []);
            this.quests = data.quests || [];

            this.isLoaded = true;
            console.log(`✅ Game Data Loaded: ${this.items.length} Items, ${this.npcs.length} NPCs.`);
        } catch (e) {
            console.error("❌ Failed to load game data from API:", e.message);
            // Если API недоступен, сервер не сможет работать корректно
            if (e.response) console.error("Status:", e.response.status);
        }
    }

    getItem(id) {
        return this.items.find(i => i.id == id);
    }

    getNPC(id) {
        return this.npcs.find(n => n.id == id);
    }

    getDialog(id) {
        return this.dialogs.find(d => d.id == id);
    }

    // Вспомогательный метод для парсинга JSON в диалогах (как в старом коде)
    _processDialogs(rawDialogs) {
        return rawDialogs.map(d => {
            if (typeof d.conditions === 'string' && d.conditions.length > 2) {
                try { d.conditions = JSON.parse(d.conditions); } catch (e) {}
            }
            return d;
        });
    }

    // Вспомогательный метод для расчета статов NPC (из старого кода)
    _processNPCs(rawNPCs) {
        return rawNPCs.map(npc => {
            if (typeof npc.interaction === 'string') {
                try { npc.interaction = JSON.parse(npc.interaction); } catch (e) {}
            }
            
            // Расчет характеристик (Legacy logic)
            let hp = 0.5014 * Math.pow(npc.level, 3) - 13.0202 * Math.pow(npc.level, 2) + 183.9156 * npc.level + 358.6032;
            let attack = 0.4235 * Math.pow(npc.level, 3) - 5.9615 * Math.pow(npc.level, 2) + 56.8842 * npc.level + 158.6538;
            let armor = 0.1252 * Math.pow(npc.level, 3) - 3.6235 * Math.pow(npc.level, 2) + 46.0185 * npc.level + 197.4798;

            if (!npc.class) {
                hp *= 0.75;
                attack *= 1.25;
                armor *= 0.8;
            }

            npc.hp = Math.floor(hp);
            npc.maxHp = Math.floor(hp);
            npc.attack = Math.floor(attack);
            npc.armor = Math.floor(armor);
            
            return npc;
        });
    }
}

module.exports = new GameDataManager();