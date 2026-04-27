const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_BACKUP_CHAT_ID;
const API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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
 * Get image URL from Telegram using file_id or message_id
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function getTelegramImageUrl(fileId) {
  try {
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
      const filePath = response.data.result.file_path;
      const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

      return {
        success: true,
        url: imageUrl,
      };
    }

    return {
      success: false,
      error: response.data.description || "Failed to get image URL",
    };
  } catch (error) {
    console.error("Get Telegram image URL error:", error.message);
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
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return {
        success: false,
        error: "Telegram configuration missing",
      };
    }

    const response = await axios.get(`${API_BASE_URL}/getMessage`, {
      params: { chat_id: TELEGRAM_CHAT_ID, message_id: messageId },
      timeout: 10000,
    });

    if (response.data.ok && response.data.result) {
      const message = response.data.result;
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
  }
}

module.exports = {
  uploadImageToTelegram,
  getTelegramImageUrl,
  getTelegramMessage,
};
