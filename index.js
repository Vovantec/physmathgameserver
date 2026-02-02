const _ = require('lodash');
var crypto = require("crypto");

// Подключение MySQL2
const mysql = require("mysql2");
  
const connection = mysql.createPool({
  connectionLimit: 5,
  host: "localhost",
  user: "root",
  database: "default",
  password: "v07o10v98a27n57t84ec"
});

// Подключение Socket.io
const fs = require('fs');

const io = require("socket.io")(3000, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e9,
  pingTimeout: 60000
});

// ===== Игровые миры (карты) =====
const maps = () => fs.readFileSync('data/maps.json').toString();
const map_0 = () => fs.readFileSync('data/map_0.json').toString();

// ===== Локальные переменные для проверок =====
const classessNameRu = ['Воин', 'Рыцарь', 'Лучник', 'Маг', 'Жрец'];
var partyCounter = 1, PLAYERS_PARTIES = [];
var DIALOGS, DIALOGS_TREE = [], NPCS, QUESTS, TASKS, ITEMS, ABILITIES, IMAGES;
var ITEMS_SET, ARMORS_SET;
var BATTLES;

// Слоты инвентаря
var INVENTORY_TYPE_SLOTS = {
  "0": "Шлем",
  "1": "Верх",
  "2": "Низ",
  "3": "Перчатки",
  "4": "Пояс",
  "5": "Ботинки",
  "6": "Меч, Топор, Лук, Арбалет, Посох",
  "8": "Наручи",
  "9": "Наплечники",
  "10": "Плащ",
  "11": "Кольцо",
  "12": "Серьга",
  "13": "Ожерелье",
  "14": "Щит, Стрелы, Болты",
}

// ===== Переменные для редактирования характеристик =====
var ATTACKBONUS = 0;

// ===== Локальное сохранение игровых данных =====
function updateGameData(callback) {
  // ===== Диалоги =====
  connection.query("SELECT * FROM dialogs",
    function(err, results, fields) {
      if (err) console.log(err);
      DIALOGS = results;

      // Преобразование ответов в JSON
      for (let i = 0; i < DIALOGS.length; i++) {
        if (DIALOGS[i].conditions.length > 2) {
          DIALOGS[i].conditions = JSON.parse(DIALOGS[i].conditions);
        }
      }

      // Создание дерева данных
      createDialogTreeData();
  });

  // ===== NPCs =====
  connection.query("SELECT * FROM npcs",
    function(err, results, fields) {
      if (err) console.log(err);
      NPCS = results;

      for (let i = 0; i < NPCS.length; i++) {
        // Преобразование ответов в JSON
        if (NPCS[i].interaction) {
          NPCS[i].interaction = JSON.parse(NPCS[i].interaction);
        }

        // ===== Здоровье =====
        // Танк
        NPCS[i].hp = 0.5014 * Math.pow(NPCS[i].level, 3) - 13.0202 * Math.pow(NPCS[i].level, 2) + 183.9156 * NPCS[i].level + 358.6032;
        // ДД
        if (!NPCS[i].class) { 
          NPCS[i].hp = NPCS[i].hp * 0.75;
        }
        NPCS[i].maxHp = NPCS[i].hp;

        // ===== Урон =====
        // Танк
        NPCS[i].attack = 0.4235 * Math.pow(NPCS[i].level, 3) - 5.9615 * Math.pow(NPCS[i].level, 2) + 56.8842 * NPCS[i].level + 158.6538;
        // ДД
        if (!NPCS[i].class) { 
          NPCS[i].attack = NPCS[i].attack * 1.25;
        }

        // ===== Защита =====
        // Танк
        NPCS[i].armor = 0.1252 * Math.pow(NPCS[i].level, 3) - 3.6235 * Math.pow(NPCS[i].level, 2) + 46.0185 * NPCS[i].level + 197.4798;
        // ДД
        if (!NPCS[i].class) { 
          NPCS[i].armor = NPCS[i].armor * 0.8;
        }
      }
  });

  // ===== Задания =====
  connection.query("SELECT * FROM quests",
    function(err, results, fields) {
      if (err) console.log(err);
      QUESTS = results;
  });

  // ===== Задачи =====
  connection.query("SELECT * FROM tasks",
    function(err, results, fields) {
      if (err) console.log(err);
      TASKS = results;
  });

  // ===== Картинки =====
  connection.query("SELECT * FROM images",
    function(err, results, fields) {
      if (err) console.log(err);
      IMAGES = results;

      // ===== Предметы =====
      connection.query("SELECT * FROM items",
        function(err, results, fields) {
          if (err) console.log(err);
          ITEMS = results;
          for (let i = 0; i < ITEMS.length; i++) {
            if (ITEMS[i].img) {
              ITEMS[i].img = IMAGES[ITEMS[i].img - 1];
            }
          }

          // ===== Наборы дропов =====
          connection.query("SELECT * FROM items_set",
            function(err, results, fields) {
              if (err) console.log(err);
              ITEMS_SET = results;
              for (let i = 0; i < ITEMS_SET.length; i++) {
                for (let j = 0; j < ITEMS_SET[i].items.length; j++) {
                  let img = ITEMS.find(o => o.id == ITEMS_SET[i].items[j].id).img.without_bg;
                  ITEMS_SET[i].items[j].img = img;
                }
              }

              try {
                return callback();
              } catch { }
          });
      });


  });

  // ===== Способности =====
  connection.query("SELECT * FROM abilities",
    function(err, results, fields) {
      if (err) console.log(err);
      ABILITIES = results;
  });
}

updateGameData();

// Бэкап карты
/*setInterval(() => {
  var d = new Date();

  fs.writeFile('data/backup_maps/maps_'+d.toISOString()+'.json', maps(), (err) => {
    if (err) throw err;
    console.log('Сохранение карты... ' + d.toISOString());
  });
}, 2 * 60 * 60 * 1000); // 2 часа*/

async function getAllPlayers(socket) {
	let playersList = [];
	const sockets = await io.fetchSockets();
	for (socket of sockets) {
		if (socket.data.playerData != undefined) {
			playersList.push(socket.data.playerData);
		}
  }

  socket.emit("getAllPlayers", playersList);
}

// Успешное подключение и передача информации пользователю
function connectSuccess(socket) {
  // Сохранение данных о персонаже
  getCharacterByFingerprint(socket.data.fingerprint, function(data) {
    if (!data) {
      socket.emit('notif', 'Ошибка авторизации. Персонаж не найден. Обратитесь к Администратору проекта');
      return;
    }

    // Изменение здоровья в другую переменную
    data.basicHp = data.hp;

    // Инвентарь
    for (let i = 0; i < data.inventory.length; i++) {
      if (data.inventory[i] == 'coins') continue;

      var tmpItem = ITEMS.find(o => o.id == data.inventory[i].id);
      data.inventory[i] = Object.assign(data.inventory[i], tmpItem);
    }

    // Сохраняем результат
    socket.data.playerData = data;

    // Сохранение ID
    socket.data.playerData.id = socket.id;

    // Рассчитываем аттрибуты
    calcAttributes(socket, function () {
      // Отправка данных на вход
      socket.emit('authSuccess', socket.data.playerData);

      // Вывод в консоль
      console.log("Подключился игрок: " + socket.data.playerData.name);
    });
  });

  // Отправка карты
  fs.readFile('data/maps.json', (err, data) => {
    if (err) throw err;
    socket.emit("map", JSON.parse(data));
  });

  // Отправка NPC
  socket.emit("npcs", NPCS);
}

io.on("connection", socket => {
  // Успешное подключение и главное меню
  socket.on('con', (fp, inGame) => {
    // Переподключение
    if (socket.data.playerData != undefined) return;

    // Сохранение идентификатора
    socket.data.fingerprint = fp;

    // Обновление информации о пользователях при перезапуске сервера
    if (inGame) {
      connectSuccess(socket);
      return;
    }

    // Информирование клиента об успешном подключении
    getCharacterByFingerprint(fp, function(data) {
      if (data) {
        // Формирование ответа
        var result = {
          name: data.name,
          level: data.level,
          class: data.class,
          avatar: data.avatar
        }
      }

      // Отправка результата
      socket.emit('connectSuccess', result);
    })
  });

  // Автоматическая авторизация по идентификатору
  socket.on('continueLastGame', () => {
    if (!socket.data.fingerprint) return;
    connectSuccess(socket);
  });

  // Авторизация по логину/паролю
  socket.on('auth', (name) => {
    // Отчистка активных персонажей
    clearActiveCharactersByFingerprint(socket.data.fingerprint, function() {
      // Обновление активного персонажа
      connection.query("UPDATE characters SET active='1' WHERE name='"+name+"'",
        function(err, results, fields) {
          if (err) console.log(err);

          connectSuccess(socket);
      });
    });

  // Авторизация
  socket.on('login', (login, password, fingerprint) => {
    // Отчистка активных персонажей
    const selectQuery = `SELECT id, login, password, name, fname, grade, email, admin FROM users WHERE login = ? LIMIT 1`;

    connection.query(selectQuery, [login], function (error, results, fields) {
      if (error) {
        console.log(error);
        return;
      }

      const data = results[0];

      if (!data || data.password === '') {
        console.log('Ошибка: Пользователь не найден!');
        return;
      }

      // Сравниваем пароли
      if (data.password === crypto.createHash('md5').update(crypto.createHash('md5').update(/* значение пароля из формы или другого места */).digest('hex')).digest('hex')) {

        // Генерируем случайное число и шифруем его
        const hash = crypto.createHash('md5').update(generateCode(10)).digest('hex');

        // Записываем в БД новый хеш авторизации и IP
        const updateQuery = `UPDATE users SET fingerprint=?, hash=? WHERE id=?`;
        connection.query(updateQuery, [fingerprint, hash, data.id], function (updateError, updateResults, updateFields) {
          if (updateError) {
            console.log(updateError);
            return;
          }

          // Ставим куки
          console.log('Успешно авторизовано');
        });

      } else {
        console.log('Ошибка: Вы ввели неправильный логин/пароль!');
      }
    })
  });

  // Проверка пинга
  socket.on("ping", () => {
    socket.emit('pong');
  });

  // Отрисовка персонажа у всех после подключения
  socket.on("renderPlayerForAll", () => {
    io.emit("newPlayer", socket.data.playerData);
  });

  socket.on("getAbilities", () => {
    socket.emit('getAbilities', socket.data.playerData.abilities);
  });

  socket.on('getInventory', () => {
    socket.emit('getInventory', socket.data.playerData.inventory);
  });

  socket.on('addItemInInventory', (id, grade) => {
    var item = ITEMS.find(o => o.id == id);
    if (!item) socket.emit('notif', 'Такого предмета не существует', 'error');

    for (let i = 15; i < 119; i++) {
      var playerItem = socket.data.playerData.inventory.find(o => o.pos == i);
      if (!playerItem) {
        // Добавляем предмет (локально)
        playerItem = item;
        playerItem.grade = grade;
        playerItem.pos = i;

        // Сохраняем в локальном инвентаре
        socket.data.playerData.inventory.push(playerItem);

        // Загружаем в бд
        updateInventorySQL(socket);

        // Отправляем в инвентарь
        socket.emit("getInventory", socket.data.playerData.inventory);
        return;
      }
    }

    // Если все слоты заполнены
    socket.emit('notif', 'Инвентарь переполнен', 'error');
  });

  socket.on("swapItemInventory", (oldPos, newPos) => {
    // playerInv[oldPos] - старая позиция
    // playerInv[newPos] - новая позиция
    var playerInv = socket.data.playerData.inventory;
    var oldPosItem = playerInv.find(o => o.pos == oldPos);
    var newPosItem = playerInv.find(o => o.pos == newPos);

    // ===== Проверка слотов =====
    if (INVENTORY_TYPE_SLOTS.hasOwnProperty(newPos)) { // Одеть на себя новую вещь
      if (INVENTORY_TYPE_SLOTS[newPos].includes(oldPosItem.type)) {
        if (newPosItem) { // Если перенос в занятый слот
          if (INVENTORY_TYPE_SLOTS.hasOwnProperty(oldPos)) {
            if (INVENTORY_TYPE_SLOTS[oldPos].includes(newPosItem.type)) {
              swapItemInventory(socket, oldPos, newPos);
            }
          } else {
            swapItemInventory(socket, oldPos, newPos);
          }
        } else {
          swapItemInventory(socket, oldPos, newPos);
        }
      } else {
        socket.emit("notif", 'Неподходящий слот для предмета "'+oldPosItem.name+'"', "error");
      }
    } else if (INVENTORY_TYPE_SLOTS.hasOwnProperty(oldPos)) { // Одеть на себя переносимую вещь
      if (newPosItem) {
        if (INVENTORY_TYPE_SLOTS[oldPos].includes(newPosItem.type)) {
          swapItemInventory(socket, oldPos, newPos);
        } else {
          socket.emit("notif", 'Неподходящий слот для предмета "'+newPosItem.name+'"', "error");
        }
      } else {
        swapItemInventory(socket, oldPos, newPos);
      }
    } else {
      swapItemInventory(socket, oldPos, newPos);
    }
  });

  socket.on("message", (data) => {
    console.log(data);
  });

  socket.on("saveMap", (data) => {
    fs.writeFile('data/maps.json', data, (err) => {
      if (err) throw err;
      socket.emit("notif", "Карта успешно обновлена!", "success");
    });
  });

  socket.on("getItemInfo", (id) => {
    var data = socket.data.playerData.inventory.find(o => o.id == id);
    if (!data) {
      var data = ITEMS.find(o => o.id == id);
    }
    socket.emit("getItemInfo", data);
  });

  socket.on("showAdminMenuButton", () => {
    if (socket.data.playerData.admin) {
      socket.emit("showAdminMenuButton");
    }
  });

  socket.on("showAdminMenu", () => {
    if (socket.data.playerData.admin) {
      socket.emit("showAdminMenu");
    }
  });

  socket.on("adminMenuRefresh", () => {

  });

  socket.on("getDialogTreeData", () => {
    if (socket.data.playerData.admin) socket.emit("getDialogTreeData", DIALOGS_TREE);
  })

  socket.on("getDialogsIdForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    getDialogsID(function(result) {
      socket.emit('getDialogsIdForAdminMenu', result);
    })
  });

  socket.on("getQuestsIdForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    getQuestsID(function(result) {
      socket.emit('getQuestsIdForAdminMenu', result);
    })
  });

  socket.on("getDialogDataById", (id) => {
    var dialog = DIALOGS.find(o => o.id == id);
    if (!dialog) {
      console.log(id + ' - не нашел диалог');
      return;
    }

    socket.emit("getDialogDataById", dialog);
  });

  socket.on("createNewDialog", (data) => {
    if (!socket.data.playerData.admin) return;

    // Внесение нового диалога в базу данных
    createNewDialog(data, function() {
      socket.emit("editDialogSuccess");

      // Обновление диалогов
      updateLocalDialogs();
    });
  });

  socket.on("updateDialog", (data) => {
    if (!socket.data.playerData.admin) return;

    // Изменение диалога в базе данных
    updateDialog(data, function() {
      socket.emit("editDialogSuccess");

      // Обновление диалогов
      updateLocalDialogs();
    });
  })

  socket.on("getAllQuestsForNPCForAdminMenu", (id) => {
    if (!socket.data.playerData.admin) return;

    socket.emit("getAllQuestsForNPCForAdminMenu", QUESTS);
  })

  socket.on("getAllNPCsForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit("getAllNPCsForAdminMenu", NPCS);
  })

  socket.on("getNPCForAdminMenu", (id) => {
    if (!socket.data.playerData.admin) return;

    var npc = NPCS.find(o => o.id == id);
    if (!npc) {
      npc = {}
      npc.id = '';
      npc.type = 0;
      npc.class = 0;
      npc.name = '';
      npc.avatar = 'Factions/Faction_Icon_Red.png';
      npc.skin = 'Dwarf_1';
      npc.elite = 0;
      npc.coords = 'Указать';
      npc.location = 'start';
      npc.level = '';
      npc.dodge = '';
      npc.interaction = {};
      npc.respawn = '';
      npc.drop_main = 0;
      npc.drop_trash = 0;
    }

    if (npc.interaction.dialog) {
      socket.emit('getNPCForAdminMenu', npc, ITEMS_SET, DIALOGS);
    } else {
      socket.emit('getNPCForAdminMenu', npc, ITEMS_SET);
    }
  });

  socket.on("getItemsSetForNPCForAdminMenu", (id) => {
    if (!socket.data.playerData.admin) return;

    var itemsSet = ITEMS_SET.find(o => o.id == id);
    if (!itemsSet) {
      socket.emit('notif', 'Набор не найден', 'error');
      return;
    }

    socket.emit('getItemsSetForNPCForAdminMenu', itemsSet);
  })

  socket.on("getInteractionForAdminMenu", (value) => {
    if (!socket.data.playerData.admin) return;

    if (value == 'dialog') {
      socket.emit('getInteractionForAdminMenu', DIALOGS);
    }
  });

  socket.on("updateNPC", (data) => {
    if (!socket.data.playerData.admin) return;

    updateNPCSQL(data, function() {
      socket.emit('notif', 'NPC успешно добавлен/обновлен!', 'success');
      io.emit('respawnAllNPCs', NPCS);
    });
  });

  socket.on("getAllItemsForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit('getAllItemsForAdminMenu', ITEMS);
  });

  socket.on("getAllItemsForAdminInventory", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit('getAllItemsForAdminInventory', ITEMS);
  });

  socket.on("getAllItemsInItemsSetForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit('getAllItemsInItemsSetForAdminMenu', ITEMS);
  });

  socket.on("getItemForAdminMenu", (id) => {
    if (!socket.data.playerData.admin) return;

    var data = ITEMS.find(o => o.id == id);
    if (data) {
      socket.emit("getItemForAdminMenu", data);
    } else {
      data = {
        "id": '',
        "name": "",
        "description": "",
        "sset": "",
        "rarity": "обычный",
        "type": "Шлем",
        "itemtype": "Легкая броня",
        "class": "Лучник",
        "strength": 0,
        "agility": 0,
        "endurance": 0,
        "intelligence": 0,
        "spirit": 0,
        "patk": 0,
        "matk": 0,
        "pdef": 0,
        "mdef": 0,
        "pcritchance": 0,
        "pcritmult": 0,
        "mcritchance": 0,
        "mcritmult": 0,
        "evasion": 0,
        "accuracy": 0,
        "hp": 0,
        "mp": 0,
        "hpregen": 0,
        "mpregen": 0,
        "aggression": 0,
        "block": 0,
        "specialskill": "",
        "lvl": 0,
        "buy": 0,
        "sell": 0,
        "img": {
          "id": 2393,
          "section": "item",
          "type": "alchemy",
          "quality": "high",
          "without_bg": "images/items/alchemy/high_1/without_bg/1.png",
          "bg": "images/items/alchemy/high_1/bg/1.png"
        }
      }
      socket.emit("getItemForAdminMenu", data);
      // socket.emit("notif", "Предмет не найден", "error");
    }
  });

  socket.on("saveItemForAdminMenu", (data, type) => {
    if (!socket.data.playerData.admin) return;

    if (type == 'update') {
      updateItemSQL(data, function() {
        socket.emit('notif', data.name + ' успешно ИЗМЕНЕН', 'success');
        socket.emit('getAllItemsForAdminMenu', ITEMS);
      });
    } else {
      insertItemSQL(data, function() {
        socket.emit('notif', data.name + ' успешно СОЗДАН', 'success');
        socket.emit('getAllItemsForAdminMenu', ITEMS);
      });
    }
  });

  socket.on("getAllItemsSetForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit('getAllItemsSetForAdminMenu', ITEMS_SET);
  });

  socket.on("getItemsSetForAdminMenu", (id) => {
    if (!socket.data.playerData.admin) return;

    var itemsSet = ITEMS_SET.find(o => o.id == id);
    if (!itemsSet) {
      // Запрос на создание нового набора предметов
      var data = {}
      data.id = '';
      data.name = 'Название';
      data.type = 0;
      data.items = []
      data.items.push({
        "id": "new-item",
        "img": "images/items/new.png",
        "count": 1,
        "percent": 0
      })
      socket.emit('getItemsSetForAdminMenu', data);
      return;
    }

    socket.emit('getItemsSetForAdminMenu', itemsSet);
  });

  socket.on("saveItemsSetForAdminMenu", (data) => {
    if (!socket.data.playerData.admin) return;

    console.log(data);

    if (data.id) {
      updateItemsSetSQL(data, function() {
        socket.emit('notif', 'Набор предметов ' + data.name + ' успешно ИЗМЕНЕН', 'success');
        socket.emit('getAllItemsSetForAdminMenu', ITEMS_SET);
      });
    } else {
      insertItemsSetSQL(data, function() {
        socket.emit('notif', 'Набор предметов ' + data.name + ' успешно СОЗДАН', 'success');
        socket.emit('getAllItemsSetForAdminMenu', ITEMS_SET);
      });
    }
  });

  socket.on("getAllArmorsSetForAdminMenu", () => {
    if (!socket.data.playerData.admin) return;

    socket.emit('getAllArmorsSetForAdminMenu', ARMORS_SET);
  });

  socket.on("getImagesForAdminMenu", (type) => {
    if (!socket.data.playerData.admin) return;

    var imgs = IMAGES.filter(o => o.section == type);
    socket.emit('getImagesForAdminMenu', imgs);
  });

  socket.on("getMap", (data) => {
    socket.emit("map", JSON.parse(maps()));
  });

  socket.on("path", (name, path) => {
    // Сохранение местоположения игрока в базе
    saveArrMap(name, path[path.length-1]);

    // Отправка пути всем игрокам
  	io.emit("pathPlayer", name, path);
  });

  // Выход пользователя из игры
  socket.on("disconnect", (reason) => {
    // Оповещение о выходе игрока
  	try {
  		io.emit("disconnectPlayer", socket.data.playerData.name);
  		console.log("Игрок " + socket.data.playerData.name + " отключился");
  	} catch { }

    // Если вышел в бою
    for (let i = 0; i < FightScenes.length; i++) {
      let scene = FightScenes[i].players.find(o => o.name == socket.data.playerData.name);
      if (scene != undefined) FightScenes.splice(i, 1);
    }

    // Если был в группе
    try {
      if (socket.data.playerData.party) {
        socket.data.playerData.party.leave(socket);
      }
    } catch { }
  });

  socket.on("getAllPlayers", () => {
  	getAllPlayers(socket);
  });

  // Взаимодействие с NPC
  socket.on("interactNPC", (id) => {
    var npc = NPCS.find(o => o.id == id);

    if (npc.type) {
      if (socket.data.playerData.name != 'VN') {
        startFightOld(socket, 'npc', id)
      } else {
        startFight(socket, 'npc', id);
      }
    } else {
      for (let key in npc.interaction) {
        switch (key) {
          case 'dialog':
            checkAndSendDialog(socket, npc.interaction[key], npc.name);
            break;
          case 'quest':
            socket.emit('newQuest', QUESTS.find(o => o.id == npc.interaction[key]));
            break;
          default:
            console.log('Неизвестный ответ - ' + key);
            break;
        }
      }
    }
  });

  // Продолжить диалог
  socket.on("continueDialog", (data) => {
    checkAndSendDialog(socket, data.id, data.name);
  });

  // ===== Боевая система =====

  // Взаимодействие в бою
  socket.on("FightInteract", (id, abilityID) => {
    // ===== Поиск боя =====
    var scene = FightScenes.find(o => o.id == id);

    // Если бой не найден
    if (!scene) {
      socket.emit("errFightScene");
      return;
    }

    // ===== Поиск игроков и монстров =====
    var player = scene.players.find(o => o.name == socket.data.playerData.name);
    var monster = scene.monsters[0];

    // ===== Проверка хода =====
    if (scene.turns[0] != scene.players.findIndex(o => o.name == player.name)) {
      socket.emit("FightNotYourTurn");
      return;
    }

    // ===== Поиск таргета =====
    var target = scene.monsters.find(o => o.id == id);
    if (!target) {
      target = scene.players.find(o => o.id == id);
      if (!target) {
        socket.emit("notif", 'Цель не найдена', 'error');
        return;
      } else {
        target.typeTarget = 'monster';
      }
    } else {
      target.typeTarget = 'player';
    }

    // ===== Вероятность успеха =====
    var valueChance = 90 + Number(player.accuracyBonus) - Number(monster.dodge);
    if (checkChance(valueChance)) {
      // ===== Обычная атака / Атака со способностью =====
      if (abilityID) {
        // ===== Поиск способности и проверка условий =====
        var ability = ABILITIES.find(o => o.id == abilityID);

        // Способность не найдена
        if (!ability) {
          socket.emit("notif", 'Использованной способности нет в игре', 'error');
          return;
        }

        // Способности нет у игрока
        let findAbilityInPlayer = player.abilities.find(o => o.id == abilityID);
        if (!findAbilityInPlayer) {
          socket.emit("notif", 'Способность еще не изучена', 'error');
          return;
        }

        // Атакующая способность на союзника
        if (ability.patk && target.typeTarget == 'player') {
          socket.emit("notif", 'Нельзя применить атакующую способность на союзника', 'error');
          return;
        }

        if (ability.matk && target.typeTarget == 'player') {

        }
      } else {

      }


      // Рассчет урона
      var damage = player.attack * (getRandomInRange(90, 110) / 100) * 80 / monster.armor;

      // Если атака со способностью
      if (abilityID) {
        var abilities = player.abilities.find(o => o.id == abilityID);

        // Если способность лечит
        if (abilities.heal != 0) {

        }
        damage = damage * (100 + abilities.attack) / 100;
        console.log('Удар со способностью');
      }

      // Убивавляем здоровье
      monster.hp -= damage;

      console.log(player.name + ' нанес ' + damage + ' урона по ' + monster.name);

      // Отправляем данные участникам боя (Успех)
      io.to(scene.emit).emit("FightInteract", player.name, id, damage);
    } else {
      // Отправляем данные атакующему (Неудача)
      io.to(scene.emit).emit("FightInteract", player.name, id, 'fail');
    }

    // Меняем ход
    var turn = scene.turns[0];
    scene.turns.shift();
    scene.turns.push(turn);

    // Проверка на смерть монстров
    for (let i = 0; i < scene.monsters.length; i++) {
      if (scene.monsters[i].hp > 0) break;
      if (i == scene.monsters.length - 1) {
        scene.finished = true;
        io.to(scene.emit).emit("FightFinish", player.name);
        console.log('Бой закончен. Победитель - ' + player.name);

        // ===== Получение опыта =====
        // Расчет коэфициента опыта
        let coefExp;
        if (player.level - monster.level < -4) {
          coefExp = 0;
        } else if (-4 <= player.level - monster.level && player.level - monster.level < -2) {
          coefExp = 0.5;
        } else if (-2 <= player.level - monster.level && player.level - monster.level < 3) {
          coefExp = 1;
        } else if (3 <= player.level - monster.level && player.level - monster.level < 5) {
          coefExp = 1.5;
        } else if (5 <= player.level - monster.level) {
          coefExp = 2;
        } else {
          console.log('!!ОШИБКА РАСЧЕТА КОЭФИЦИЕНТА!!');
          console.log(monster);
          coefExp = 0;
        }
        
        // Формула для опыта
        let exp = (15 * monster.level + 30) * coefExp * (monster.elite + 1) / scene.players.length;

        // Сохранение опыта для всех участников
        var clientsInRoom = io.sockets.adapter.rooms.get(scene.emit);
        for (const clientId of clientsInRoom) {
          var clientSocket = io.sockets.sockets.get(clientId);
          updateCharacterExp(clientSocket, exp);
        }

        // Удаление боя
        for (let i = 0; i < FightScenes.length; i++) {
          if (FightScenes[i] == scene) {
            FightScenes.splice(i, 1);
          }
        }

        return;
      }
    }

    // Проверка следующего хода
    if (scene.turns[0] == scene.players.length) {
      setTimeout((scene, player, monster) => {
        io.to(scene.emit).emit("FightMonsterAttackPlayer", player.name, monster.id, monster.attack);
        player.hp -= monster.attack;
        console.log(monster.name + ' нанес ' + monster.attack + ' урона по ' + player.name);

        // Проверка на смерть игроков
        for (let i = 0; i < scene.players.length; i++) {
          if (scene.players[i].hp > 0) break;
          if (i == scene.players.length - 1) {
            scene.finished = true;
            io.to(scene.emit).emit("FightFinish", monster.name);
            console.log('Бой закончен. Победитель - Монстр');

            // Удаление боя
            for (let i = 0; i < FightScenes.length; i++) {
              if (FightScenes[i] == scene) {
                FightScenes.splice(i, 1);
              }
            }

            return;
          }
        }

        // Меняем ход
        var turn = scene.turns[0];
        scene.turns.shift();
        scene.turns.push(turn);
      }, 2000, scene, player, monster);
    }
  });

  // ===== Система создания группы =====

  socket.on("PartyReq", (playerID) => {
    // Запрет приглашения себе
    if (socket.data.playerData.id == playerID) return;

    // Поиск участника по имени
    var subSocket = findPlayerDataByID(playerID);
    if (!subSocket) {
      socket.emit("notif", 
        "Ошибка приглашения в группе. Игрок не найден", "error");
      return;
    }

    // Если инициатор уже в группе
    if (socket.data.playerData.party) {
      // Если таргет в группе
      if (subSocket.data.playerData.party) {
        socket.emit("notif", "Игрок " + subSocket.data.playerData.name + " находится в группе", "error");
        return;
      }

      // Отправка приглашения в группу
      socket.data.playerData.party.invite(subSocket);
      return;
    }

    // Запрос на вступление в группу
    if (subSocket.data.playerData.party && !socket.data.playerData.party) {
      subSocket.data.playerData.party.requestToJoin(socket);
      return;
    }

    // Создание новой группы
    PLAYERS_PARTIES.push(new Party(socket, subSocket));
  });

  socket.on("PartyAccept", () => {
    socket.data.playerData.party.join(socket);
  });

  socket.on("PartyLeave", (playerID) => {
    // Поиск участника по имени
    var subSocket = findPlayerDataByID(playerID);
    if (!subSocket) {
      socket.emit("notif", 
        "Ошибка исключения из группы. Игрок не найден", "error");
      return;
    }

    // Исключение из группы
    socket.data.playerData.party.leave(subSocket);
  });
});

// ===== Диалоги =====

function createDialogTreeData() {
  // Отчистка
  DIALOGS_TREE = [];

  // Нахождение максимума в диалогах
  var array = [];
  for (let i = 0; i < DIALOGS.length; i++) {
    array.push(DIALOGS[i].parent);
  }
  var max = Math.max.apply(null, array)+1;

  for (let i = 0; i < max; i++) {
    for (let j = 0; j < DIALOGS.length; j++) {
      // Если не соответствует родителю
      if (DIALOGS[j].parent != i) continue;

      // Вносим диалоги с нулевым родителем
      if (i == 0) {
        DIALOGS_TREE.push(DIALOGS[j]);
        continue
      }

      // Находим родителя в дереве и добавляем ему диалог
      fn(DIALOGS_TREE, "id", DIALOGS[j]);
    }
  }
}

function fn(obj, key, dialog) {
    if (_.has(obj, key) && obj[key] == dialog.parent) // or just (key in obj)
      if (obj.children) {
        obj.children.push(dialog);
      } else {
        obj.children = [];
        obj.children.push(dialog);
      }
    // elegant:
    return _.flatten(_.map(obj, function(v) {
        return typeof v == "object" ? fn(v, key, dialog) : [];
    }), true);

    // or efficient:
    var res = [];
    _.forEach(obj, function(v) {
        if (typeof v == "object" && (v = fn(v, key, dialog)).length)
            res.push.apply(res, v);
    });
    return res;
}

function checkAndSendDialog(socket, id, npcName) {
  // Поиск диалога по id
  var dialog = DIALOGS.find(o => o.id == id);
  if (!dialog) {
    socket.emit('errDialog', 'Такого диалога не существует. ID - ' + id);
    return;
  }
  dialog.children = [];

  // Проверка условий
  if (checkDialogConditions(socket, dialog)) {
    for (let i = 0; i < DIALOGS.length; i++) {
      if (DIALOGS[i].parent == dialog.id) {
        if (checkDialogConditions(socket, dialog)) {
          dialog.children.push(DIALOGS[i]);
        }
      }
    }

    // Отправка ответа
    dialog.name = npcName;
    socket.emit('dialog', dialog);
  }
}

function checkDialogConditions(socket, dialog) {
  // Если условий нет
  if (!dialog.conditions) {
    return true;
  }

  // Проверка условий
  /*
  for (let key in dialog.conditions) {
    switch (key) {
      case 'beforeDialog':
        var data = socket.data.playerData.dialogs.find(o => o.id == dialog.conditions[key]);
        if (data) return false;
        break;
      case 'afterDialog':
        var data = socket.data.playerData.dialogs.find(o => o.id == dialog.conditions[key]);
        if (!data) return false;
        break;
      case 'admin':
        if (socket.data.playerData.admin != Number(dialog.conditions[key])) return false;
        break;
      default:
        console.log(key + ' неизвестное условие в диалоге');
        break;
    }
  }
  */

  return true;
}

// ===== Боевая система =====

var FightScenes = [];

// Сохранение местоположения игрока в базе
function saveArrMap(name, arrMap) {
  connection.query("UPDATE characters SET arrMap='"+arrMap[0]+"-"+arrMap[1]+"' WHERE name='"+name+"'",
    function(err, results, fields) {
      if (err) console.log(err);

      console.log('[' + arrMap + '] ' + name);
  });
}

// ===== Система группы =====

class Party {
  constructor(initSocket, subSocket) {
    // Хранилище группы
    this.leader = initSocket;
    this.players = [initSocket];
    //this.emit = crypto.randomBytes(10).toString('hex');
    this.emit = 'party-1';
    console.log(this.emit);
    this.invited = [];

    // Вступление в чат группы
    initSocket.data.playerData.party = this;
    initSocket.join(this.emit);

    // Информирование игрока о создании группы
    initSocket.emit('notif', 'Группа создана', 'success');

    // Отправка приглашения игроку
    this.invite(subSocket);
  }

  invite(socket) {
    // Сохранение пользователя в списке запросов
    this.invited.push(socket);

    // Сохранение данных группы в участнике
    socket.data.playerData.party = this;

    // Отправка запроса
    this.invited[this.invited.length-1]
      .emit('PartyInvite', this.leader.data.playerData.name);
  }

  requestToJoin(socket) {
    // Сохранение пользователя в списке запросов
    this.invited.push(socket);

    // Сохранение данных группы в участнике
    socket.data.playerData.party = this;

    // Отправка запроса лидеру
    this.leader.emit('PartyJoinRequest', socket.data.playerData.name);
  }

  join(socket) {
    // Удаление игрока из списка приглашенных
    for (let i = 0; i < this.invited.length; i++) {
      if (this.invited[i].data.playerData.id == socket.data.playerData.id) {
        console.log(this.invited[i].data.playerData.name + ' удален из приглашенных');
        this.invited.splice(i, 1);
      }
    }

    // Информирование всех участников о вступлении
    io.to(this.emit).emit('PartyJoin', 
    [{
      'id': socket.data.playerData.id,
      'name': socket.data.playerData.name,
      'avatar': socket.data.playerData.avatar,
      'level': socket.data.playerData.level,
      'hp': socket.data.playerData.hp,
      'mana': socket.data.playerData.mana
    }]);

    // Информирование нового участника о всех игроках группы
    var players = [];
    for (let i = 0; i < this.players.length; i++) {
      players.push({
        'id': this.players[i].data.playerData.id,
        'name': this.players[i].data.playerData.name,
        'avatar': this.players[i].data.playerData.avatar,
        'level': this.players[i].data.playerData.level,
        'hp': this.players[i].data.playerData.hp,
        'mana': this.players[i].data.playerData.mana
      })
    }
    socket.emit('PartyJoin', players);

    // Добавление игрока в группу
    this.players.push(socket);
    socket.join(this.emit);
  }

  declineInvite(socket) {
    // Удаление игрока из списка приглашенных
    for (let i = 0; i < this.invited.length; i++) {
      if (this.invited[i].data.playerData.id == socket.data.playerData.id) {
        this.invited.splice(i, 1);
      }
    }

    // Удаление группы у игрока
    socket.data.playerData.party = undefined;

    // Информирование лидера группы
    this.leader.emit('notif', 'Игрок ' + socket.data.playerData.name + ' отклонил запрос на вступление', 'error');
  
    // Проверка количества участников группы
    if (this.players.length < 2) {
      // Удаление из чата группы
      this.leader.data.playerData.party = undefined;
      this.leader.leave(this.emit);

      // Удаление группы из базы
      for (let i = 0; i < PLAYERS_PARTIES.length; i++) {
        if (PLAYERS_PARTIES[i].emit == this.emit) {
          this.leader.emit('notif', 'Группа удалена', 'error');
          console.log('Группа с лидером ' + this.leader.data.playerData.name + ' удалена');
          PLAYERS_PARTIES.splice(i, 1);
          delete this;
          console.log('Количество групп - ' + PLAYERS_PARTIES.length);
        }
      }
    }
  }

  leave(socket) {
    // Удаление игрока из списка группы
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].data.playerData.id == socket.data.playerData.id) {
        this.players.splice(i, 1);
      }
    }

    // Удаление данных о группе у игрока
    socket.data.playerData.party = undefined;
    socket.leave(this.emit);

    // Информирование всех участников группы
    io.to(this.emit).emit('PartyLeave', socket.data.playerData.name);

    // Проверка количества участников группы
    if (this.players.length < 2) {
      // Удаление из чата группы
      this.leader.leave(this.emit);

      // Удаление группы из базы
      for (let i = 0; i < PLAYERS_PARTIES.length; i++) {
        if (PLAYERS_PARTIES[i].emit == this.emit) {
          this.leader.emit('notif', 'Группа удалена', 'error');
          console.log('Группа с лидером ' + this.leader.data.playerData.name + ' удалена');
          PLAYERS_PARTIES.splice(i, 1);
          delete this;
          console.log('Количество групп - ' + PLAYERS_PARTIES.length);
        }
      }
    }
  }

  message(data) {
    io.to(this.emit).emit('notif', data, 'info');
  }
}

// ===== Боевая система =====

class Battle {
  constructor(data) {
    // ===== Создание команд =====
    this.teams = [data.teams];
    
    // ===== Создание списка запросов на подтверждения боя =====
    if (data.invited) {
      this.invited = data.invited;


    }
  }

  findPlayersDataInParty(party) {
    var socketsInRoom = io.sockets.adapter.rooms.get(party);
    var playersData = [];
    for (socketId of socketsInRoom) {
      var client = io.sockets.sockets.get(socketId);

      // Восстановление здоровья
      client.data.playerData.hp = client.data.playerData.maxHp;

      // Чат команды

      // Добавляем игрока
      playersData.push(client.data.playerData);
    }

    return playersData;
  }

  findPlayerInScene() {

  }

  leavePlayer() {

  }

  removeScene() {

  }
}

function startFight(socket, type, id) {
  // ===== Бой с NPC =====
  if (type == 'npc-duel') {
    // Поиск монстра
    var npc = NPCS.find(o => o.id == id);
    if (!npc) {
      socket.emit('notif', 'Такого монстра не существует', 'error');
      return;
    }

    // Готовность монстра к бою
    if (!npc.ready) {
      socket.emit('notif', 'Монстр не готов к бою. Возможно, он уже в бою или убит', 'error');
      return;
    }

    // Готовность игрока к бою
    if (socket.data.playerData.battle) {
      socket.emit('notif', 'Вы еще в бою', 'error');
      return;
    }

    // Формирование данных для создания боя
    var data = {
      "creator": socket.data.playerData.name,
      "teams": [[npc], [socket]]
    }

    // Создание боя
    BATTLES.push(new Battle(data));
  }

  // ===== Бой с NPC в группе =====
  if (type == 'npc-group-duel') {

  }

  // ===== Бой с игроком =====
  if (type == 'player-duel') {

  }

  // ===== Бой с игроками в группе =====
  if (type == 'player-group-duel') {

  }
}

function startFightOld(socket, type, id) {
  // Проверка, если уже в бою с этим монстром
  let findFight = FightScenes.find(o => o.id == id);
  if (findFight != undefined) {
    socket.emit("FightAlreadyInBattle");
    return;
  }

  // Создание сцены боя
  var fightScene = {};
  fightScene.id = id;
  fightScene.emit = socket.id;
  fightScene.finished = false;
  fightScene.party = undefined;

  // Проверка, если состоит в группе
  for (let room of socket.rooms) {
    if (room.indexOf("party") != -1) {
      fightScene.party = room;
      fightScene.emit = room;
    }
  }  

  // ===== Сбор данных об игроках =====
  fightScene.players = [];

  if (fightScene.party === undefined) {
    // Восстановление здоровья
    socket.data.playerData.hp = socket.data.playerData.maxHp;

    // Добавляем игрока
    fightScene.players.push(socket.data.playerData);
  } else {
    var socketsInRoom = io.sockets.adapter.rooms.get(fightScene.party);
    for (socketId of socketsInRoom) {
      var client = io.sockets.sockets.get(socketId);

      // Восстановление здоровья
      client.data.playerData.hp = client.data.playerData.maxHp;

      // Добавляем игрока
      fightScene.players.push(client.data.playerData);
    }
  }

  // Заполнение данных о монстре в соло режиме
  fightScene.monsters = [];
  let monster = NPCS.find(o => o.id == id);
  monster.hp = monster.maxHp;
  fightScene.monsters.push(monster);

  // ===== Создание последовательности ходов =====
  fightScene.turns = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < fightScene.players.length + fightScene.monsters.length; j++) {
      fightScene.turns.push(j);
    }
  }

  // Вносим в базу эту сцену
  FightScenes.push(fightScene);

  // Начало боя
  io.to(fightScene.emit).emit("FightStarted", fightScene.monsters, fightScene.players, fightScene.turns);
}

// ===== Дополнительные функции =====

// Поиск socket данных участника по ID
function findPlayerDataByID(id) {
  var client = io.sockets.sockets.get(id);
  if (!client) return false;

  // Восстановление здоровья
  client.data.playerData.hp = client.data.playerData.maxHp;

  return client;
}

// Проверка до следующего уровня
function updateCharacterExp(socket, exp) {
  var expNext = 40 * Math.pow(socket.data.playerData.level, 2) + 360 * socket.data.playerData.level;

  // Добавляем опыт
  socket.data.playerData.exp += exp;

  // Проверяем опыт до следующего уровня
  if (socket.data.playerData.exp > expNext) {
    socket.data.playerData.exp -= expNext;
    socket.data.playerData.level += 1;

    // Сохранение нового уровня в бд
    updateCharacterLevelSQL(socket);

    // Оповещение игрока о новом уровне
    socket.emit('notif', 'Ваш уровень повышен до ' + socket.data.playerData.level, 'success');
  }

  socket.emit('notif', 'Получено ' + exp + ' опыта', 'success');
  socket.emit('notif', 'Опыт: ' + socket.data.playerData.exp + '/' + expNext, 'success');

  // Сохранение опыта в бд
  updateCharacterExpSQL(socket);
}

// Перемещение предметов в инвентаре
function swapItemInventory(socket, oldPos, newPos) {
  var oldPosItem = socket.data.playerData.inventory.find(o => o.pos == oldPos);
  var newPosItem = socket.data.playerData.inventory.find(o => o.pos == newPos);

  // ===== Проверка класса персонажа и вещи =====
  if (newPos < 15) {
    if (!oldPosItem.class.includes(socket.data.playerData.class)) {
      socket.emit("notif", oldPosItem.name + ' не соответствует классу персонажа', 'error');
      return;
    }
  }

  if (oldPos < 15 && newPosItem) {
    if (!newPosItem.class.includes(socket.data.playerData.class)) {
      socket.emit("notif", newPosItem.name + ' не соответствует классу персонажа', 'error');
      return;
    }
  }

  // ===== Меняем слоты в локальном инвентаре =====
  var tmpPos = oldPos;
  if (newPosItem) {
    oldPosItem.pos = newPosItem.pos;
    newPosItem.pos = tmpPos;
  } else {
    console.log('Изменил');
    oldPosItem.pos = newPos;
  }

  // Загружаем в бд
  updateInventorySQL(socket);

  // Возвращаем измененный инвентарь игроку
  socket.emit("getInventory", socket.data.playerData.inventory);

  // Перерасчет атррибутов
  calcAttributes(socket);
}

// Вставка предмета в бд
function insertItemSQL(data, callback) {
  // Формируем запрос
  var keys = '', values = '';
  for (key in data) {
    keys += '`' + key + '`, ';
    values += "'" + data[key] + "', ";
  }

  keys = keys.slice(0, -2);
  values = values.slice(0, -2);

  // Загружаем в бд
  connection.query("INSERT INTO `items`(" + keys + ") VALUES (" + values + ")",
    function(err, results, fields) {
      if (err) console.log(err);
    }
  )

  updateGameData(function() {
    return callback();
  });
}

// Изменение предмета в бд
function updateItemSQL(data, callback) {
  var sql = '';

  // Формируем запрос
  for (key in data) {
    if (key == 'id') continue;
    sql += "`" + key + "`='" + data[key] + "', ";
  }

  sql = sql.slice(0, -2);

  // Загружаем в бд
  connection.query("UPDATE `items` SET " + sql + "WHERE id=" + data.id,
    function(err, results, fields) {
      if (err) console.log(err);

      updateGameData(function() {
        return callback();
      });
    }
  )
}

// Вставка комплекта предметов в бд
function insertItemsSetSQL(data, callback) {
  // Формируем запрос
  var keys = '', values = '';
  for (key in data) {
    keys += '`' + key + '`, ';
    values += "'" + data[key] + "', ";
  }

  keys = keys.slice(0, -2);
  values = values.slice(0, -2);

  // Загружаем в бд
  connection.query("INSERT INTO `items_set`(" + keys + ") VALUES (" + values + ")",
    function(err, results, fields) {
      if (err) console.log(err);
    }
  )

  updateGameData(function() {
    return callback();
  });
}

// Изменение комплекта предметов в бд
function updateItemsSetSQL(data, callback) {
  var sql = '';

  // Формируем запрос
  for (key in data) {
    if (key == 'id') continue;
    sql += "`" + key + "`='" + data[key] + "', ";
  }

  sql = sql.slice(0, -2);

  // Загружаем в бд
  connection.query("UPDATE `items_set` SET " + sql + "WHERE id=" + data.id,
    function(err, results, fields) {
      if (err) console.log(err);

      updateGameData(function() {
        return callback();
      });
    }
  )
}

// Сохранение инвентаря в бд
function updateInventorySQL(socket) {
  // Сокращенный формат для базы данных
  var inventoryDB = [];
  for (let i = 0; i < socket.data.playerData.inventory.length; i++) {
    if (socket.data.playerData.inventory[i].hasOwnProperty('coins')) {
      inventoryDB.push(socket.data.playerData.inventory[i]);
      continue;
    }

    var tmp = {};
    tmp.id = socket.data.playerData.inventory[i].id;
    tmp.pos = socket.data.playerData.inventory[i].pos;
    tmp.grade = socket.data.playerData.inventory[i].grade;
    inventoryDB.push(tmp);
  }

  // Загружаем в бд
  connection.query("UPDATE `characters` SET inventory='"+JSON.stringify(inventoryDB)+"' WHERE name='"+socket.data.playerData.name+"'",
    function(err, results, fields) {
      if (err) console.log(err);
    }
  )
}

// Сохранение NPC в бд
function updateNPCSQL(data, callback) {
  if (data.id) {
    connection.query("UPDATE `npcs` SET `type`='"+data.type+"',`class`='"+data.class+"',`name`='"+data.name+"',`skin`='"+data.skin+"',`avatar`='"+data.avatar+"',`elite`='"+data.elite+"',`coords`='"+data.coords+"',`location`='"+data.location+"',`interaction`='{\""+data.interaction+"\":"+data.interactionSub+"}',`level`='"+data.level+"',`dodge`='"+data.dodge+"',`respawn`='"+data.respawn+"',`drop_main`='"+data.drop_main+"',`drop_trash`='"+data.drop_trash+"' WHERE id="+data.id,
      function(err, results, fields) {
        if (err) console.log(err);

        // Обновление игровых данных
        updateGameData(function() {
          return callback();
        });
      }
    )
  } else {
    connection.query("INSERT INTO `npcs`(`type`, `class`, `name`, `skin`, `avatar`, `elite`, `coords`, `location`, `interaction`, `level`, `dodge`, `respawn`) VALUES ('"+data.type+"','"+data.class+"','"+data.name+"','"+data.skin+"','"+data.avatar+"','"+data.elite+"','"+data.coords+"','"+data.location+"','{\""+data.interaction+"\":"+data.interactionSub+"}','"+data.level+"','"+data.dodge+"','"+data.respawn+"')",
      function(err, results, fields) {
        if (err) console.log(err);

        // Обновление игровых данных
        updateGameData(function() {
          return callback();
        });
      }
    )
  }
}

// Сохранение уровня персонажа в бд
function updateCharacterLevelSQL(socket) {
  // Загружаем в бд
  connection.query("UPDATE `characters` SET level='"+socket.data.playerData.level+"' WHERE name='"+socket.data.playerData.name+"'",
    function(err, results, fields) {
      if (err) console.log(err);
    }
  )
}

// Сохранение опыта персонажа в бд
function updateCharacterExpSQL(socket) {
  // Загружаем в бд
  connection.query("UPDATE `characters` SET exp='"+socket.data.playerData.exp+"' WHERE name='"+socket.data.playerData.name+"'",
    function(err, results, fields) {
      if (err) console.log(err);
    }
  )
}

// Расчет аттрибутов персонажа
function calcAttributes(socket, callback) {
  // Необходимые свойства для расчета
  var needAttr = [
    'strength', 'agility', 'endurance', 'intelligence', // Характеристики персонажа
    'patk', 'matk', 'pdef', 'mdef', // Атака и защита от предметов (числовой)
    'pcritchance', 'pcritmult', 'mcritchance', 'mcritmult', // Крит. урон (проценты)
    'evasion', 'accuracy', // Уклонение, точность (проценты)
    'hp', 'mp', 'hpregen', 'mpregen', // Здоровье, мана, регенерация (числовой)
    'agression', 'block' // Агрессия (числовой), Блокирование (проценты)
  ];

  // Отчистка текущих дополнительных аттрибутов
  for (let i = 0; i < needAttr.length; i++) {
    socket.data.playerData[needAttr[i] + 'Bonus'] = 0;
  }

  // Расчет и сохранение аттрибутов персонажу
  var inv = socket.data.playerData.inventory;
  for (let key in inv) {
    // Если вещь в одетом слоте (включая 14 слот)
    if (key != 'coins') 
      if (Number(key) > 14) continue;

    for (let i = 0; i < needAttr.length; i++) {
      // Если такой аттрибут существует у предмета
      if (inv[key][needAttr[i]]) {
        socket.data.playerData[needAttr[i] + 'Bonus'] += inv[key][needAttr[i]];
      }
    }
  }

  // Временная отправка текущих аттрибутов
  //socket.emit("consolelog", socket.data.playerData);

  // Расчет аттрибутов персонажа
  calcAttributesCharacter(socket, callback);
}

// Расчет аттрибутов персонажа
function calcAttributesCharacter(socket, callback) {
  // Здоровье персонажа
  socket.data.playerData.hp = ((socket.data.playerData.endurance + socket.data.playerData.enduranceBonus) * 30 + socket.data.playerData.basicHp) * (1 + 4 * socket.data.playerData.level / 100) * (1 + socket.data.playerData.hpregenBonus / 100);
  socket.data.playerData.hp = socket.data.playerData.hp.toFixed(1);
  socket.data.playerData.maxHp = socket.data.playerData.hp;

  // Регенерация персонажа в бою
  socket.data.playerData.regenHp = ((socket.data.playerData.endurance + socket.data.playerData.enduranceBonus) * 5 + 60) * (1 + 4 * socket.data.playerData.level / 100) * (1 + socket.data.playerData.hpregenBonus / 100);

  // Атака персонажа
  if (socket.data.playerData.class == 'Маг' || socket.data.playerData.class == 'Жрец') {
    socket.data.playerData.attack = ((socket.data.playerData.intelligence + socket.data.playerData.intelligenceBonus) * 5 + socket.data.playerData.matkBonus * 15) * (1 + 4 * socket.data.playerData.level / 100) * (1 + ATTACKBONUS / 100);
  } else if (socket.data.playerData.class == 'Лучник') {
    socket.data.playerData.attack = ((socket.data.playerData.agility + socket.data.playerData.agilityBonus) * 5 + socket.data.playerData.patkBonus * 15) * (1 + 4 * socket.data.playerData.level / 100) * (1 + ATTACKBONUS / 100);
  } else {
    socket.data.playerData.attack = ((socket.data.playerData.strength + socket.data.playerData.strengthBonus) * 5 + socket.data.playerData.patkBonus * 15) * (1 + 4 * socket.data.playerData.level / 100) * (1 + ATTACKBONUS / 100);
  }

  console.log('Атака ' + socket.data.playerData.name + ' - ' + socket.data.playerData.attack);
  console.log('patkBonus - ' + socket.data.playerData.patkBonus);

  // Обновление способностей для персонажа
  updateLocalAbilitiesCharacter(socket, callback);
}

// Обновление способностей для персонажа
function updateLocalAbilitiesCharacter(socket, callback) {
  // Находим способности, соответствующие персонажу
  var abilities = ABILITIES.filter(o => o.class == socket.data.playerData.class 
    && socket.data.playerData.level - o.levelstudy > 0 
    && socket.data.playerData.level - o.levelstudy < 5
    && o.levelstudy != 0);

  // Сохраняем способности персонажа
  socket.data.playerData.abilities = abilities;

  try {
    return callback();
  } catch { }
}

function updateLocalDialogs() {
  // Диалоги
  connection.query("SELECT * FROM dialogs",
    function(err, results, fields) {
      if (err) console.log(err);
      DIALOGS = results;

      // Преобразование ответов в JSON
      for (let i = 0; i < DIALOGS.length; i++) {
        if (DIALOGS[i].conditions.length > 2) {
          DIALOGS[i].conditions = JSON.parse(DIALOGS[i].conditions);
        }
      }

      // Создание дерева данных
      createDialogTreeData();
  });
}

function createNewDialog(data, callback) {
  connection.query("INSERT INTO `dialogs`(`parent`, `title`, `text`, `conditions`) VALUES ('"+data.parent+"', '"+data.title+"', '"+data.text+"', '"+data.conditions+"')",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results);
    }
  )
}

function updateDialog(data, callback) {
  connection.query("UPDATE `dialogs` SET parent='"+data.parent+"',title='"+data.title+"',text='"+data.text+"',conditions='"+data.conditions+"' WHERE id='"+data.id+"'",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results);
    }
  )
}

function getDialogByID(id, callback) {
  connection.query("SELECT * FROM dialogs WHERE id='"+id+"'",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results);
    }
  )
}

function getDialogsID(callback) {
  connection.query("SELECT id FROM dialogs",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results);
    }
  )
}

function getQuestsID(callback) {
  connection.query("SELECT id FROM quests",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results);
    }
  )
}

function getCharacterByFingerprint(fp, callback) {
  // Данные об аккаунте
  connection.query("SELECT * FROM users WHERE fingerprint='"+fp+"'",
    function(err, results, fields) {
      if (err) console.log(err);

      // Идентификатор не найден
      if (!results.length) {
        return callback(null);
      }

      // Данные о персонаже
      for (let i = 0; i < results.length; i++) {
        connection.query("SELECT * FROM characters WHERE login='"+results[i].login+"' AND active='1'",
          function(err, res, fields) {
            if (err) console.log(err);

            if (!res.length) {
              return;
            }

            res[0].admin = results[i].admin;;
            res[0].tester = results[i].tester;
            res[0].skin = classessNameRu.indexOf(res[0].class);
            res[0].avatar = 'images/gui/resource/Textures/Unit Frames/Main/Avatar/'+res[0].skin+'.png';

            // Формирование ответа
            return callback(res[0]);
        });
      }
  });
}

// Данные о персонаже по имени
function getCharacterByName(name, callback) {
  connection.query("SELECT * FROM characters WHERE name='"+name+"'",
    function(err, results, fields) {
      if (err) console.log(err);
      return callback(results[0]);
  });
}

// Отчистка активных персонажей по идентификатору
function clearActiveCharactersByFingerprint(fp, callback) {
  connection.query("SELECT * FROM users WHERE fingerprint='"+fp+"'",
      function(err, results, fields) {
        if (err) console.log(err);

        connection.query("UPDATE characters SET active='0' WHERE login='"+results[0].login+"'",
          function(err, results, fields) {
            if (err) console.log(err);

            return callback();
        });
  });
}

// Случайное число в диапазоне
function getRandomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Расчет вероятности
function checkChance(value) {
  var random = getRandomInRange(1, 100);
  if (value > random) {
    return true;
  } else {
    return false;
  }
}

/*

-- Для персонажа
var lvlUp = 40 * Math.sqrt(player.lvl) + 360 * player.lvl;

-- Опыт с монстра (расчет для каждого игрока)
var lvlCoef = player.lvl - monster.lvl;
switch (lvlCoef) {
  case 
}

var expFromMonster = ((15 * monster.lvl + 30) * lvlCoef * monster.elite) / users.length;

-- Деньги с монстра
var moneyDrop = (0.3 * Math.pow(monster.lvl, 3) - 6 * Math.sqrt(monster.lvl) + 40.85 * monster.lvl - 5.2) * monster.elite;

-- Здоровье персонажа
var playerHP = ((player.endurance + player.enduranceBonus) * 30 + player.hp) * (1 + 4 * player.lvl / 100) * player.buffActive * player.buffPassive * (1 + player.hpBonus / 100) * player.globalDebuff;

-- Реген здоровья +
var hpRegenInBattle = ((player.endurance + player.enduranceBonus) * 5) * (1 + 4 * player.lvl / 100) * player.buffActive * player.buffPassive * (1 + player.hpBonus / 100) * player.globalDebuff;

-- Шанс попасть
var hit = 90% + player.accuracy - enemy.dodge;

-- Шанс критического урона (со всех предметов)

-- Урон от персонажа
enemy.def - Если ты физ, то бьешь по физ. Если маг, то бьешь по маг

var dmg = player.attack * (getRandomInRange(90, 110) / 100) * 80 / enemy.def * (100 + abilities.attack) / 100;



*/