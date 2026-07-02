// Public (mijoz telefoni ochadigan) manzil asosi.
// PUBLIC_URL env ustuvor; bo'lmasa so'rov host'idan aniqlanadi (zaxira).
function publicBaseUrl(req) {
  const env = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { publicBaseUrl };
