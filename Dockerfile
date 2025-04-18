# Gunakan image resmi Node.js
FROM node:18

# Buat direktori kerja
WORKDIR /app

# Copy dependency files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy semua source code ke dalam container
COPY . .

# Aplikasi jalan di port 3000
EXPOSE 3000

# Jalankan server
CMD ["node", "app.js"]
