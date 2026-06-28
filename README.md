# U-FLEX POS Backend

Universal POS tizimi uchun Node.js + Express + Prisma + PostgreSQL backend.
Do'konlar va xo'jalik mollari (xozmak) do'konlari uchun mos.

## Imkoniyatlar

- Mahsulotlar (SKU + **barcode**), kategoriyalar va filiallar boshqaruvi
- Ombor nazorati (filial bo'yicha)
- Sotuvlar, ochiq (draft) buyurtmalar, to'lovlar va tranzaksiyalar tarixi
- Skaner uchun `GET /api/products/barcode/:code` (barcode YOKI sku bo'yicha topish)
- Mahsulot rasmlari **Railway bucket (S3-mos)** da saqlanadi
- DB backup **bucket'ga** JSON sifatida (kunlik)
- Real-time chek chop etish (Socket.IO `new_sale`)
- Eskiz SMS integratsiyasi

## O'rnatish

```bash
npm install
npx prisma generate
```

`.env.example` asosida `.env` yarating (yoki Railway "Variables" ga kiriting).

### Asosiy env

```env
PORT=8080
JWT_SECRET=<kuchli-tasodifiy-kalit>
PG_CONNECTION=postgresql://user:pass@host:port/dbname
```

### Rasm saqlash (Railway bucket, S3-mos)

```env
S3_ENDPOINT=<bucket-endpoint>
S3_BUCKET=orderly-tortellini
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
# Bucket public bo'lsa to'g'ridan-to'g'ri URL, aks holda bo'sh (backend proxy ishlatadi)
S3_PUBLIC_URL=
```

Sozlanmasa server ishlayveradi, faqat rasm yuklash o'chiq bo'ladi.
Bucket **private** bo'lsa ham ishlaydi: rasm `GET /api/products/image/:sku` proxy orqali ko'rsatiladi.

### DB backup (bucket'ga)

```env
DB_BACKUP_ENABLED=true
DB_BACKUP_CRON=0 3 * * *
DB_BACKUP_TZ=Asia/Tashkent
DB_BACKUP_PREFIX=backups
```

Backup har kuni barcha jadvallarni JSON qilib bucket'ning `backups/<vaqt>/` papkasiga yuklaydi.
Qo'lda: `npm run backup:now`.

## Migratsiya (Railway)

```bash
npx prisma migrate deploy
```

⚠️ Railway production DB'da **`prisma migrate reset` ISHLATMANG** (Prisma guard bloklaydi va ma'lumot o'chadi).
Yangi ustunlar idempotent (`ADD COLUMN IF NOT EXISTS`).

## Universal katalog seed

```bash
npm run seed:catalog
```

Do'kon + xozmak kategoriyalari va namuna mahsulotlar (barcode bilan) qo'shadi.

## Ishga tushirish

```bash
npm run dev      # nodemon
npm start        # bootstrap supervisor (production)
```

## Railway eslatma

- `postgres.railway.internal` hosti faqat Railway ichki tarmog'ida ishlaydi.
- Lokalda Railway Postgres **Public Networking** connection stringini `PG_CONNECTION`ga qo'ying.
- Backend va Postgres bir project/environment ichida bo'lishi kerak.

## Asosiy API yo'llari

| Yo'l | Tavsif |
| --- | --- |
| `POST /api/admin/login` · `POST /api/worker/login` | Kirish (`{phone, password}`) |
| `GET /api/products` · `GET /api/products/barcode/:code` | Mahsulotlar, skaner lookup |
| `POST /api/products/upload-image` | Rasm yuklash (bucket) |
| `GET /api/inventory/branch/:branchId` | Filial ombori |
| `GET /api/sales` · `POST /api/sales` | Sotuvlar (`status:"open"` → draft) |
| `GET /api/sales/pending` · `POST /api/sales/:id/close` | Ochiq buyurtmalar, yopish |
| `GET /api/categories` · `GET /api/branches` | Kategoriya, filial |
