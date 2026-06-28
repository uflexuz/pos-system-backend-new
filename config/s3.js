/**
 * S3-mos obyekt saqlash servisi (Railway bucket / Tigris / MinIO / R2 / AWS S3).
 *
 * Kerakli env o'zgaruvchilari:
 *   S3_ENDPOINT            - bucket endpoint (masalan: https://fly.storage.tigris.dev)
 *   S3_BUCKET              - bucket nomi (masalan: orderly-tortellini)
 *   S3_ACCESS_KEY_ID       - access key
 *   S3_SECRET_ACCESS_KEY   - secret key
 *   S3_REGION              - region (ixtiyoriy, default: auto)
 *   S3_FORCE_PATH_STYLE    - "true" bo'lsa path-style URL (MinIO/Tigris uchun kerak bo'lishi mumkin)
 *   S3_PUBLIC_URL          - bucket public bo'lsa, to'g'ridan-to'g'ri public bazaviy URL (ixtiyoriy)
 *
 * Agar sozlanmagan bo'lsa, server ishlayveradi — faqat rasm yuklash o'chiq bo'ladi.
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
const S3_REGION = process.env.S3_REGION || "auto";
const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || "true") === "true";
const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

let client = null;

/**
 * Bucket sozlangan-sozlanmaganligini tekshiradi.
 */
function isConfigured() {
  return Boolean(
    S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
  );
}

/**
 * S3 clientni bir marta yaratadi (lazy singleton).
 */
function getClient() {
  if (!isConfigured()) {
    throw new Error(
      "Bucket sozlanmagan: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY kerak"
    );
  }

  if (!client) {
    client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      forcePathStyle: S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    });
  }

  return client;
}

/**
 * Obyektni bucket'ga yuklaydi.
 * @param {string} key - obyekt kaliti (masalan: products/abc-123.jpg)
 * @param {Buffer} body - fayl buffer
 * @param {string} contentType - MIME turi
 * @returns {Promise<{key: string, publicUrl: string|null}>}
 */
async function uploadObject(key, body, contentType) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return {
    key,
    publicUrl: S3_PUBLIC_URL ? `${S3_PUBLIC_URL}/${key}` : null,
  };
}

/**
 * Obyektni bucket'dan o'chiradi (xato bo'lsa ham server yiqilmaydi).
 * @param {string} key
 */
async function deleteObject(key) {
  if (!key || !isConfigured()) return;

  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })
    );
  } catch (error) {
    console.warn("Bucket obyektini o'chirishda xatolik:", error.message);
  }
}

/**
 * Obyektni stream + content-type sifatida qaytaradi (rasm proxy uchun).
 * @param {string} key
 * @returns {Promise<{stream: ReadableStream, contentType: string, contentLength: number|undefined}>}
 */
async function getObjectStream(key) {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key })
  );

  return {
    stream: response.Body,
    contentType: response.ContentType || "application/octet-stream",
    contentLength: response.ContentLength,
  };
}

module.exports = {
  isConfigured,
  uploadObject,
  deleteObject,
  getObjectStream,
  S3_PUBLIC_URL,
  S3_BUCKET,
};
