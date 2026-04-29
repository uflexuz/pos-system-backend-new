const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_BACKUP_CHAT_ID;
const API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_URL_RE = /^https:\/\/api\.telegram\.org\/file\/bot[^/]+\/(.+)$/i;
const REMOTE_FILE_PREFIX = "remote-file:";

function getTelegramFilePathFromImage(image) {
  if (!image) return null;

  const value = String(image);
  if (value.startsWith(REMOTE_FILE_PREFIX)) {
    return value.slice(REMOTE_FILE_PREFIX.length).replace(/^\/+/, "");
  }

  const telegramUrlMatch = value.match(TELEGRAM_FILE_URL_RE);
  if (telegramUrlMatch) {
    return telegramUrlMatch[1].replace(/^\/+/, "");
  }

  const legacyProxyPrefix = "/api/products/" + "telegram-image/";
  if (value.startsWith(legacyProxyPrefix)) {
    return value
      .slice(legacyProxyPrefix.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/")
      .replace(/^\/+/, "");
  }

  return null;
}

function isTelegramBackedImage(image) {
  return Boolean(getTelegramFilePathFromImage(image));
}

function getTelegramFileDownloadUrl(filePath) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram configuration missing");
  }

  const normalizedPath = String(filePath || "").replace(/^\/+/, "");
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${normalizedPath}`;
}

async function streamTelegramFile(filePath) {
  return axios.get(getTelegramFileDownloadUrl(filePath), {
    responseType: "stream",
    timeout: 15000,
  });
}

async function getTelegramFilePath(fileId) {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      success: false,
      error: "Telegram configuration missing",
    };
  }

  const response = await axios.get(`${API_BASE_URL}/getFile`, {
    params: { file_id: fileId },
    timeout: 10000,
  });

  if (response.data.ok && response.data.result) {
    return {
      success: true,
      filePath: response.data.result.file_path,
    };
  }

  return {
    success: false,
    error: response.data.description || "Failed to get image URL",
  };
}

/**
 * Upload image to Telegram and get message_id
 * @param {Buffer|string} fileData - File buffer or file path
 * @param {string} fileName - File name
 * @returns {Promise<{success: boolean, messageId?: string, fileId?: string, error?: string}>}
 */
async function uploadImageToTelegram(fileData, fileName = "product_image.jpg") {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return {
        success: false,
        error: "Telegram configuration missing",
      };
    }

    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);

    // Handle buffer or file path
    if (typeof fileData === "string" && fs.existsSync(fileData)) {
      formData.append("photo", fs.createReadStream(fileData));
    } else if (Buffer.isBuffer(fileData)) {
      formData.append("photo", fileData, { filename: fileName });
    } else {
      return {
        success: false,
        error: "Invalid file data",
      };
    }

    formData.append("caption", `Product Image: ${fileName}`);

    const response = await axios.post(`${API_BASE_URL}/sendPhoto`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
    });

    if (response.data.ok && response.data.result) {
      const messageId = response.data.result.message_id;
      const photoArray = response.data.result.photo;
      const fileId = photoArray?.[photoArray.length - 1]?.file_id;

      return {
        success: true,
        messageId: String(messageId),
        fileId,
      };
    }

    return {
      success: false,
      error: response.data.description || "Failed to upload to Telegram",
    };
  } catch (error) {
    console.error("Telegram upload error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get message from Telegram by message_id to retrieve photo
 * @param {string} messageId - Telegram message_id
 * @returns {Promise<{success: boolean, fileId?: string, error?: string}>}
 */
async function getTelegramMessage(messageId) {
  let forwardedMessageId = null;

  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return {
        success: false,
        error: "Telegram configuration missing",
      };
    }

    const response = await axios.post(`${API_BASE_URL}/forwardMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      from_chat_id: TELEGRAM_CHAT_ID,
      message_id: Number(messageId),
      disable_notification: true,
    }, {
      timeout: 10000,
    });

    if (response.data.ok && response.data.result) {
      const message = response.data.result;
      forwardedMessageId = message.message_id;

      if (message.photo && message.photo.length > 0) {
        const fileId = message.photo[message.photo.length - 1].file_id;
        return {
          success: true,
          fileId,
        };
      }
    }

    return {
      success: false,
      error: response.data.description || "Failed to get message",
    };
  } catch (error) {
    console.error("Get Telegram message error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (forwardedMessageId) {
      axios.post(`${API_BASE_URL}/deleteMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: forwardedMessageId,
      }, {
        timeout: 5000,
      }).catch((error) => {
        console.warn("Telegram temporary message cleanup error:", error.message);
      });
    }
  }
}

async function getTelegramFilePathByMessageId(messageId) {
  const messageResult = await getTelegramMessage(messageId);
  if (!messageResult.success) {
    return messageResult;
  }

  try {
    return await getTelegramFilePath(messageResult.fileId);
  } catch (error) {
    console.error("Get Telegram file path by message ID error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function streamTelegramMessageImage(messageId) {
  const filePathResult = await getTelegramFilePathByMessageId(messageId);
  if (!filePathResult.success) {
    throw new Error(filePathResult.error || "Failed to resolve message image");
  }

  return streamTelegramFile(filePathResult.filePath);
}

module.exports = {
  uploadImageToTelegram,
  getTelegramMessage,
  getTelegramFilePathByMessageId,
  getTelegramFilePathFromImage,
  isTelegramBackedImage,
  streamTelegramFile,
  streamTelegramMessageImage,
};
