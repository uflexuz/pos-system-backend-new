// Tigris bucket ulanish testi (putObject + getObject). Vaqtincha skript.
require("dotenv").config();
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const cfg = {
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || "auto",
  ak: process.env.S3_ACCESS_KEY_ID,
  sk: process.env.S3_SECRET_ACCESS_KEY,
};
console.log("Endpoint:", cfg.endpoint, "| Bucket:", cfg.bucket, "| Region:", cfg.region);

async function tryStyle(forcePathStyle) {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle,
    credentials: { accessKeyId: cfg.ak, secretAccessKey: cfg.sk },
  });
  const key = `products/_conn-test.txt`;
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: Buffer.from("uflex s3 connectivity ok"),
      ContentType: "text/plain",
    })
  );
  // qaytadan o'qish
  const got = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const body = await got.Body.transformToString();
  // tozalash
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  return body;
}

(async () => {
  for (const fps of [false, true]) {
    try {
      const body = await tryStyle(fps);
      console.log(`\n✅ MUVAFFAQIYAT (forcePathStyle=${fps}): put+get+delete OK, o'qildi: "${body}"`);
      console.log(`>>> Tavsiya: S3_FORCE_PATH_STYLE="${fps}"`);
      process.exit(0);
    } catch (e) {
      console.log(`❌ forcePathStyle=${fps} ishlamadi: ${e.name} — ${e.message}`);
    }
  }
  console.log("\nIkkala uslub ham ishlamadi. Kalitlar yoki endpoint tekshirilsin.");
  process.exit(1);
})();
