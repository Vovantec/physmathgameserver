const Party = require('../mechanics/Party');

class PartyManager {
    constructor(room) {
        this.room = room;
        this.parties = new Map(); // id -> Party
        this.lastId = 0;
    }

    // Обработка запроса на создание/приглашение
    handleInvite(client, targetSessionId) {
        const sender = this.room.state.players.get(client.sessionId);
        const target = this.room.state.players.get(targetSessionId);
        const targetClient = this.room.clients.find(c => c.sessionId === targetSessionId);

        if (!sender || !target || !targetClient) {
            client.send("notif", { message: "Игрок не найден", type: "error" });
            return;
        }

        if (client.sessionId === targetSessionId) {
            client.send("notif", { message: "Нельзя пригласить себя", type: "error" });
            return;
        }

        let party = this.getPartyByPlayer(client.sessionId);

        // 1. Если у отправителя нет группы -> Создаем новую
        if (!party) {
            // Если у цели уже есть группа
            if (target.partyId) {
                client.send("notif", { message: "Игрок уже в группе", type: "error" });
                return;
            }

            party = this.createParty(client.sessionId);
        } else {
            // Если отправитель не лидер
            if (party.leaderId !== client.sessionId) {
                client.send("notif", { message: "Только лидер может приглашать", type: "error" });
                return;
            }
        }

        // 2. Отправляем приглашение
        party.invite(targetSessionId);
        targetClient.send("party:invite", { 
            partyId: party.id, 
            senderName: sender.name 
        });
        
        client.send("notif", { message: `Приглашение отправлено ${target.name}`, type: "success" });
    }

    handleAccept(client, partyId) {
        const party = this.parties.get(partyId);
        const player = this.room.state.players.get(client.sessionId);

        if (!party || !party.invited.has(client.sessionId)) {
            client.send("notif", { message: "Приглашение недействительно", type: "error" });
            return;
        }

        if (player.partyId) {
            client.send("notif", { message: "Вы уже в группе", type: "error" });
            return;
        }

        // Вступаем
        party.addMember(client.sessionId);
        player.partyId = party.id; // Обновляем стейт игрока

        // Уведомляем всех
        this.broadcastPartyUpdate(party);
        client.send("notif", { message: "Вы вступили в группу", type: "success" });
    }

    handleLeave(client) {
        const player = this.room.state.players.get(client.sessionId);
        if (!player || !player.partyId) return;

        const party = this.parties.get(player.partyId);
        if (!party) return;

        party.removeMember(client.sessionId);
        player.partyId = ""; // Очищаем стейт

        party.broadcast("party:message", { text: `${player.name} покинул группу` });

        if (party.isEmpty()) {
            this.parties.delete(party.id);
        } else {
            this.broadcastPartyUpdate(party);
        }
        
        // Очистка на клиенте
        client.send("party:update", null); 
    }

    createParty(leaderId) {
        const id = `party_${++this.lastId}`;
        const party = new Party(id, leaderId, this.room);
        this.parties.set(id, party);
        
        // Обновляем стейт лидера
        const leader = this.room.state.players.get(leaderId);
        if (leader) leader.partyId = id;

        this.broadcastPartyUpdate(party);
        return party;
    }

    getPartyByPlayer(sessionId) {
        const player = this.room.state.players.get(sessionId);
        if (player && player.partyId) {
            return this.parties.get(player.partyId);
        }
        return null;
    }

    // Отправляет актуальный список членов группы всем участникам
    broadcastPartyUpdate(party) {
        const membersData = [];
        party.members.forEach(mid => {
            const p = this.room.state.players.get(mid);
            if (p) membersData.push({ 
                id: mid, 
                name: p.name, 
                lvl: p.level, 
                hp: p.hp, 
                maxHp: p.maxHp,
                class: p.class 
            });
        });

        party.broadcast("party:update", {
            id: party.id,
            leaderId: party.leaderId,
            members: membersData
        });
    }
}

module.exports = PartyManager;