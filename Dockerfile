# physmathgameserver/Dockerfile
FROM node:18-alpine

WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

# Открываем порт (проверьте какой порт в index.js, обычно 3000 или 8080)
# Судя по файлам, возможно порт задается вручную. Допустим 8080.
EXPOSE 8080

CMD ["node", "index.js"]