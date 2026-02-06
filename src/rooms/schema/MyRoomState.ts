import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("string") name: string = "";
    @type("number") skin: number = 0;

    // Очередь точек для движения на сервере.
    // Не синхронизируем это поле (нет @type), оно нужно только для расчетов
    pathQueue: any[] = [];
    
    // Скорость движения (пикселей в секунду)
    // Должна совпадать или быть чуть меньше клиентской, чтобы избежать дерганий
    speed: number = 200; 
}

export class MyRoomState extends Schema {
    @type({ map: Player }) players = new MapSchema<Player>();
}