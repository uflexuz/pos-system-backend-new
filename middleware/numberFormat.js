// Function to validate phone number format (similar to your front-end logic)
function validatePhoneNumber(phone) {
  if (isNaN(phone)) return false;
  phone = phone + "";
  // Strip out non-numeric characters
  let digits = phone.replace(/\D/g, "");

  // Check if the phone starts with '998' (Uzbekistan's country code)
  if (!digits.startsWith("998")) {
    return false; // Invalid phone number if it doesn't start with 998
  }

  // If it's exactly 12 digits, it's a valid phone number
  return digits.length === 12;
}

module.exports = validatePhoneNumber;
