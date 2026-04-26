/**
 * AI Inventory validation schemas
 */

const validateInventoryItem = (item) => {
  const errors = [];

  if (!item.name || typeof item.name !== "string" || !item.name.trim()) {
    errors.push("Mahsulot nomi kiritilishi shart");
  }

  if (
    item.quantity === undefined ||
    item.quantity === null ||
    typeof item.quantity !== "number" ||
    item.quantity < 0
  ) {
    errors.push("Miqdor to'g'ri kiritilishi shart (musbat son)");
  }

  if (!item.unit || !["kg", "dona", "litr", "gram", "metr"].includes(item.unit)) {
    errors.push("Unit 'kg', 'dona' yoki 'litr' bo'lishi kerak");
  }

  if (item.totalPrice !== undefined && item.totalPrice !== null) {
    if (typeof item.totalPrice !== "number" || item.totalPrice < 0) {
      errors.push("Narx musbat son bo'lishi kerak");
    }
  }

  return errors;
};

const validateCreateInventory = (data) => {
  const errors = [];

  if (!data.branch || typeof data.branch !== "string" || !data.branch.trim()) {
    errors.push("Filial nomi kiritilishi shart");
  }

  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    errors.push("Kamida bitta mahsulot kiritilishi kerak");
  } else {
    data.items.forEach((item, index) => {
      const itemErrors = validateInventoryItem(item);
      if (itemErrors.length > 0) {
        errors.push(`Mahsulot #${index + 1}: ${itemErrors.join(", ")}`);
      }
    });
  }

  return errors;
};

const validateUpdateInventory = (data) => {
  return validateCreateInventory(data);
};

module.exports = {
  validateInventoryItem,
  validateCreateInventory,
  validateUpdateInventory,
};
