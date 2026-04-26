const { default: axios } = require("axios");

const postTelegramMessage = (message, chatId = null) =>
  axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: chatId || process.env.TELEGRAM_SALES_CHAT_ID,
      text: message,
      parse_mode: "html",
    }
  );

// Inventory messages uchun (AI Bot chat)
const postInventoryMessage = (message) =>
  postTelegramMessage(message, process.env.TELEGRAM_INVENTORY_CHAT_ID);

// Sale messages uchun (Sales chat)
const postSaleMessage = (message) =>
  postTelegramMessage(message, process.env.TELEGRAM_SALES_CHAT_ID);

// JSON buffer'ni document sifatida yuborish
const sendDocument = (buffer, filename, caption = "", chatId = null) => {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("chat_id", chatId || process.env.TELEGRAM_SALES_CHAT_ID);
  form.append("document", buffer, { filename });
  if (caption) form.append("caption", caption);

  return axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    form,
    { headers: form.getHeaders() }
  );
};

module.exports = postTelegramMessage;
module.exports.postInventoryMessage = postInventoryMessage;
module.exports.postSaleMessage = postSaleMessage;
module.exports.sendDocument = sendDocument;
