{
  "name": "vc-metrics",
  "version": "1.2.0",
  "description": "Метрики vc.ru: показы (views), открытия (hits), авторизация и админка пользователей",
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "dev": "NODE_ENV=development node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.6",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "nodemailer": "^6.9.13"
  },
  "engines": {
    "node": ">=18"
  }
}
