class Party {
    constructor(id, leaderId, room) {
        this.id = id;
        this.leaderId = leaderId;
        this.room = room; // Ссылка на GameRoom для отправки сообщений
        
        this.members = new Set([leaderId]); // ID сессий участников
        this.invited = new Set(); // ID сессий приглашенных
    }

    addMember(clientId) {
        this.members.add(clientId);
        this.invited.delete(clientId);
    }

    removeMember(clientId) {
        this.members.delete(clientId);
        if (this.leaderId === clientId) {
            // Если вышел лидер, назначаем нового (первого попавшегося)
            const iterator = this.members.values();
            const next = iterator.next();
            if (!next.done) {
                this.leaderId = next.value;
                this.broadcast("party:leader", { leaderId: this.leaderId });
            }
        }
    }

    invite(targetId) {
        this.invited.add(targetId);
    }

    isMember(clientId) {
        return this.members.has(clientId);
    }

    isEmpty() {
        return this.members.size === 0;
    }

    // Отправка сообщения всем членам группы
    broadcast(type, data) {
        this.members.forEach(clientId => {
            const client = this.room.clients.find(c => c.sessionId === clientId);
            if (client) {
                client.send(type, data);
            }
        });
    }
    
    // Получение списка объектов Player для боя
    getPlayers() {
        const players = [];
        this.members.forEach(clientId => {
            const player = this.room.state.players.get(clientId);
            if (player) players.push(player);
        });
        return players;
    }
}

module.exports = Party;