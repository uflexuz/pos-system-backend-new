function collectErrorMessages(error) {
  const messages = [];

  if (!error) {
    return messages;
  }

  if (typeof error.message === "string") {
    messages.push(error.message);
  }

  if (typeof error.stack === "string") {
    messages.push(error.stack);
  }

  if (error.cause && typeof error.cause === "object") {
    messages.push(...collectErrorMessages(error.cause));
  }

  return messages;
}

function isDatabaseConnectionError(error) {
  const knownCodes = new Set(["P1001", "57P01", "57P02", "57P03", "ECONNRESET", "EPIPE"]);

  if (error?.code && knownCodes.has(error.code)) {
    return true;
  }

  return collectErrorMessages(error).some((message) => {
    const normalized = String(message).toLowerCase();

    return (
      normalized.includes("server has closed the connection") ||
      normalized.includes("connection terminated unexpectedly") ||
      normalized.includes("can't reach database server") ||
      normalized.includes("database server") && normalized.includes("unreachable") ||
      normalized.includes("econnreset") ||
      normalized.includes("prisma") && normalized.includes("closed the connection")
    );
  });
}

function sendDatabaseUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: "Ma'lumotlar bazasi vaqtincha mavjud emas. Keyinroq qayta urinib ko'ring.",
  });
}

module.exports = {
  isDatabaseConnectionError,
  sendDatabaseUnavailable,
};