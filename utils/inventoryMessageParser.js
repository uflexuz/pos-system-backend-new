/**
 * Telegram message parser for AI Inventory
 * Parses messages in format:
 *
 * Hadya 1
 * Pechoniy 3.230kg , 120400
 * Rulet 20 dona
 * Piramida 3 ta , 400000
 *
 * Or for update:
 * Hadya 1 , 67912ab8123812390asd21
 * ...items...
 *
 * Or for delete:
 * Hadya 1 , 67912ab8123812390asd21 , delete
 */

/**
 * Parse message to determine operation type
 * @param {string} text - Telegram message text
 * @returns {object} - { type: 'create'|'update'|'delete', data: {...} }
 */
function parseInventoryMessage(text) {
  if (!text || typeof text !== "string") {
    return {
      success: false,
      error: "Xabar matn bo'lishi kerak",
    };
  }

  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 1) {
    return {
      success: false,
      error: "Xabar bo'sh bo'lmasligi kerak",
    };
  }

  // Parse first line (branch and optional transaction_id and delete flag)
  const firstLine = lines[0];
  const firstLineParts = firstLine.split(",").map((p) => p.trim());

  const branch = firstLineParts[0];
  const transactionId = firstLineParts[1] || null;
  const isDelete =
    firstLineParts[2] && firstLineParts[2].toLowerCase().includes("delete");

  if (!branch) {
    return {
      success: false,
      error: "Filial nomi ko'rsatilishi kerak",
      suggestion: "Birinchi qatorda filial nomini kiriting",
    };
  }

  // If delete operation
  if (isDelete) {
    if (!transactionId) {
      return {
        success: false,
        error: "Delete uchun transaction_id kerak",
        suggestion: "Format: Hadya 1 , <transaction_id> , delete",
      };
    }

    return {
      success: true,
      type: "delete",
      data: {
        branch,
        transactionId,
      },
    };
  }

  // For create/update, we need items (lines after first)
  if (lines.length < 2) {
    return {
      success: false,
      error:
        "Kamida 2 qator bo'lishi kerak: filial nomi va kamida 1 ta mahsulot",
      suggestion: "Format:\nHadya 1\nPechoniy 3.230kg , 120400",
    };
  }

  // Parse items (all lines after first)
  const itemLines = lines.slice(1);
  const items = [];
  const itemErrors = [];

  for (let i = 0; i < itemLines.length; i++) {
    const lineNum = i + 2; // Line number in original message
    const itemResult = parseItemLine(itemLines[i], lineNum);

    if (!itemResult.success) {
      itemErrors.push(itemResult.error);
    } else {
      items.push(itemResult.item);
    }
  }

  if (itemErrors.length > 0) {
    return {
      success: false,
      error: "Mahsulotlarni parsing qilishda xato",
      errors: itemErrors,
      suggestion:
        "Format: Nomi miqdor[kg/dona/ta/litr] , narx\nMisol: Pechoniy 3.230kg , 120400",
    };
  }

  if (items.length === 0) {
    return {
      success: false,
      error: "Kamida bitta mahsulot kiritilishi kerak",
      suggestion: "Ikkinchi qatordan boshlab mahsulotlarni kiriting",
    };
  }

  // Determine if create or update
  const type = transactionId ? "update" : "create";

  return {
    success: true,
    type,
    data: {
      branch,
      transactionId,
      items,
    },
  };
}

/**
 * Parse single item line
 * Examples:
 * - "Pechoniy 3.230kg , 120400"  (with unit)
 * - "Rulet 20 dona"              (with unit)
 * - "Piramida 3 , 400000"        (without unit - will use product's unit)
 * - "Shokolad 5.5"               (without unit - will use product's unit)
 *
 * @param {string} line - Item line
 * @param {number} lineNum - Line number for error reporting
 * @returns {object} - { success: true, item: {...} } or { success: false, error: string }
 */
function parseItemLine(line, lineNum) {
  if (!line || !line.trim()) {
    return {
      success: false,
      error: `Qator ${lineNum}: Bo'sh qator`,
    };
  }

  // Split by comma to separate price
  const parts = line.split(",").map((p) => p.trim());
  const mainPart = parts[0]; // Name + quantity + optional unit
  const pricePart = parts[1]; // Optional price

  // Try to parse with unit first: "Pechoniy 3.230kg"
  let mainMatch = mainPart.match(/^(.+?)\s+([\d.]+)\s*([a-zA-Zа-яА-ЯёЁ]+)$/);
  
  let name, quantityStr, unitRaw;

  if (mainMatch) {
    // Has unit
    name = mainMatch[1].trim();
    quantityStr = mainMatch[2];
    unitRaw = mainMatch[3].toLowerCase();
  } else {
    // Try without unit: "Piramida 3"
    const noUnitMatch = mainPart.match(/^(.+?)\s+([\d.]+)$/);
    
    if (!noUnitMatch) {
      return {
        success: false,
        error: `Qator ${lineNum}: Format xato. Kerak: "Nomi miqdor" yoki "Nomi miqdor[kg/dona/ta/litr]"\nOlindi: "${mainPart}"`,
      };
    }
    
    name = noUnitMatch[1].trim();
    quantityStr = noUnitMatch[2];
    unitRaw = null; // Will be filled from product model
  }

  // Parse quantity
  const quantity = parseFloat(quantityStr);
  if (isNaN(quantity) || quantity <= 0) {
    return {
      success: false,
      error: `Qator ${lineNum}: Miqdor musbat son bo'lishi kerak`,
    };
  }

  // Normalize unit (if provided)
  let unit = unitRaw ? normalizeUnit(unitRaw) : null;
  if (unitRaw && !unit) {
    return {
      success: false,
      error: `Qator ${lineNum}: Unit noto'g'ri (faqat kg, dona, ta, litr, шт, l)`,
    };
  }

  // Parse price (optional)
  let totalPrice = undefined;
  if (pricePart) {
    const priceMatch = pricePart.match(/[\d.]+/);
    if (priceMatch) {
      totalPrice = parseFloat(priceMatch[0]);
      if (isNaN(totalPrice) || totalPrice < 0) {
        return {
          success: false,
          error: `Qator ${lineNum}: Narx musbat son bo'lishi kerak`,
        };
      }
    }
  }

  return {
    success: true,
    item: {
      name,
      quantity,
      unit,
      totalPrice,
    },
  };
}

/**
 * Normalize unit names
 * @param {string} unitRaw - Raw unit from message
 * @returns {string|null} - Normalized unit or null
 */
function normalizeUnit(unitRaw) {
  const unitMap = {
    // KG
    kg: "kg",
    кг: "kg",
    kilogram: "kg",
    
    // Gram
    gram: "gram",
    gr: "gram",
    g: "gram",
    грамм: "gram",
    
    // Dona/Ta
    dona: "dona",
    ta: "dona",
    piece: "dona",
    pieces: "dona",
    шт: "dona",
    
    // Litr
    litr: "litr",
    l: "litr",
    литр: "litr",
    
    // Metr
    metr: "metr",
    m: "metr",
    метр: "metr",
  };

  const normalized = unitMap[unitRaw.toLowerCase()];
  return normalized || null;
}

/**
 * Format error message for Telegram
 * @param {object} parseResult - Parse result with errors
 * @returns {string} - Formatted error message
 */
function formatParsingError(parseResult) {
  let message = "❌ Xato: " + parseResult.error + "\n\n";

  if (parseResult.errors && parseResult.errors.length > 0) {
    message += "Xatolar:\n";
    parseResult.errors.forEach((err) => {
      message += "• " + err + "\n";
    });
    message += "\n";
  }

  if (parseResult.suggestion) {
    message += "💡 To'g'ri format:\n" + parseResult.suggestion;
  }

  return message;
}

/**
 * Format success message for Telegram
 * @param {string} type - Operation type
 * @param {string} id - Transaction ID or Inventory ID
 * @returns {string} - Formatted success message
 */
function formatSuccessMessage(type, id) {
  const messages = {
    create: `✅ Inventory yaratildi\n\nTransaction ID: ${id}`,
    update: `✅ Inventory yangilandi\n\nTransaction ID: ${id}`,
    delete: `✅ Inventory o'chirildi\n\nTransaction ID: ${id}`,
  };

  return messages[type] || `✅ Muvaffaqiyatli\n\nTransaction ID: ${id}`;
}

module.exports = {
  parseInventoryMessage,
  parseItemLine,
  normalizeUnit,
  formatParsingError,
  formatSuccessMessage,
};
