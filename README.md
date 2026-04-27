# UFLEX POS Backend

UFLEX POS uchun Node.js, Express va PostgreSQL asosidagi backend.

## Imkoniyatlar

- Mahsulotlar, kategoriyalar va filiallar boshqaruvi
- Ombor nazorati
- Sotuvlar, to'lovlar va tranzaksiyalar tarixi
- Xodimlar va mijozlar boshqaruvi
- Lokal JSON DB backup scheduler

## O'rnatish

```bash
npm install
```

`.env.example` asosida `.env` faylini yarating:

```env
PORT=8080
PG_CONNECTION=postgresql://user:pass@host:port/dbname
JWT_SECRET=your_secret_key
```

Railway eslatma:

- `postgres.railway.internal` hosti faqat Railway ichki tarmog'ida ishlaydi.
- Lokal kompyuterda Railway Postgres **Public Networking** connection stringini `PG_CONNECTION`ga qo'ying.
- Backend Railway'da deploy bo'lsa, backend va Postgres bir project/environment ichida bo'lishi kerak.

Backup sozlamalari:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BACKUP_CHAT_ID=-1003708313257
DB_BACKUP_DIR=./backups
DB_BACKUP_CRON=45 15 * * *
DB_BACKUP_TZ=Asia/Tashkent
DB_BACKUP_ENABLED=true
```

Backup har kuni scheduler bo'yicha JSON fayllarni lokal `backups/` papkaga saqlaydi va Telegram bot orqali `TELEGRAM_BACKUP_CHAT_ID` chatiga yuboradi. Inventory/sales Telegram bot handlerlari ishlatilmaydi.

## Ishga tushirish

```bash
npm run dev
```

## Asosiy API yo'llari

| Yo'l | Tavsif |
| --- | --- |
| `/api/products` | Mahsulotlar |
| `/api/inventory` | Ombor |
| `/api/sales` | Sotuvlar |
| `/api/transactions` | Tranzaksiyalar |
