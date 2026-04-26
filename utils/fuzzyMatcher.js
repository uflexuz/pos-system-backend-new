/**
 * Fuzzy Matching Utility
 * O'xshash nomlarni topish va taklif berish
 */

/**
 * String'ni tozalash va normalizatsiya qilish
 * @param {string} str 
 * @returns {string}
 */
function normalizeString(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Ko'p bo'sh joylarni bitta bo'sh joy bilan almashtirish
}

/**
 * Partial matching - qisman mos kelishni tekshirish
 * @param {string} input 
 * @param {string} candidate 
 * @returns {number} 0-100 oralig'ida foiz
 */
function calculatePartialMatch(input, candidate) {
  const inputNorm = normalizeString(input);
  const candidateNorm = normalizeString(candidate);
  
  // To'liq mos kelish
  if (inputNorm === candidateNorm) return 100;
  
  // Input candidate ichida bormi?
  if (candidateNorm.includes(inputNorm)) {
    return 90;
  }
  
  // Candidate input ichida bormi?
  if (inputNorm.includes(candidateNorm)) {
    return 85;
  }
  
  // So'zlar bo'yicha mos kelish
  const inputWords = inputNorm.split(' ');
  const candidateWords = candidateNorm.split(' ');
  
  let matchedWords = 0;
  for (const inputWord of inputWords) {
    if (candidateWords.some(cw => cw.includes(inputWord) || inputWord.includes(cw))) {
      matchedWords++;
    }
  }
  
  if (matchedWords > 0) {
    const matchRatio = matchedWords / Math.max(inputWords.length, candidateWords.length);
    // Barcha so'zlar mos va soni teng bo'lsa — so'z tartibi farq ("MEDOVIK MINI" = "MINI MEDOVIK")
    if (matchedWords === inputWords.length && inputWords.length === candidateWords.length) {
      return 95;
    }
    return matchRatio * 80;
  }
  
  return 0;
}

/**
 * Levenshtein distance - ikki string orasidagi farqni hisoblash
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number}
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[len1][len2];
}

/**
 * O'xshashlik foizini hisoblash (combined)
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} 0-100 oralig'ida foiz
 */
function calculateSimilarity(str1, str2) {
  // Partial matching'ni tekshirish
  const partialScore = calculatePartialMatch(str1, str2);
  
  // Agar partial match yuqori bo'lsa, uni qaytarish
  if (partialScore >= 80) {
    return partialScore;
  }
  
  // Levenshtein distance bilan hisoblash
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  
  if (maxLength === 0) return 100;
  
  const levenshteinScore = ((maxLength - distance) / maxLength) * 100;
  
  // Qisqa so'zlarda anagram/transposition tekshirish
  // "RKM" vs "RMK" kabi holatlar uchun
  const norm1 = normalizeString(str1);
  const norm2 = normalizeString(str2);
  let anagramScore = 0;
  if (norm1.length === norm2.length && norm1.length <= 6) {
    const sorted1 = norm1.split('').sort().join('');
    const sorted2 = norm2.split('').sort().join('');
    if (sorted1 === sorted2) {
      // Bir xil harflar, faqat tartibi boshqa — yuqori ball
      anagramScore = 85;
    }
  }
  
  // Uchta score'dan maksimal qiymatni olish
  return Math.max(partialScore, levenshteinScore, anagramScore);
}

/**
 * Eng o'xshash variantlarni topish (tags bilan)
 * @param {string} input - Kiritilgan nom
 * @param {Array} candidates - Mavjud nomlar ro'yxati (har biri {name, tags} bo'lishi mumkin)
 * @param {Object} options - Sozlamalar
 * @returns {Array} O'xshash variantlar
 */
function findSimilarMatches(input, candidates, options = {}) {
  const {
    minSimilarity = 50,  // Minimal o'xshashlik foizi
    maxResults = 5,      // Maksimal natijalar soni
    threshold = 70,      // To'g'ridan-to'g'ri mos kelish uchun chegara
  } = options;
  
  if (!input || !candidates || candidates.length === 0) {
    return [];
  }
  
  // Har bir kandidat uchun o'xshashlikni hisoblash
  const matches = candidates.map(candidate => {
    const candidateName = candidate.name || candidate;
    let maxSimilarity = calculateSimilarity(input, candidateName);
    
    // Agar tags mavjud bo'lsa, ularni ham tekshirish
    if (candidate.tags && Array.isArray(candidate.tags)) {
      for (const tag of candidate.tags) {
        const tagSimilarity = calculateSimilarity(input, tag);
        if (tagSimilarity > maxSimilarity) {
          maxSimilarity = tagSimilarity;
        }
      }
    }
    
    return {
      item: candidate,
      name: candidateName,
      similarity: maxSimilarity,
      distance: levenshteinDistance(input, candidateName)
    };
  });
  
  // O'xshashlik bo'yicha saralash
  const sorted = matches
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
  
  return sorted;
}

/**
 * Aniq mos kelishni tekshirish (tags bilan)
 * @param {string} input 
 * @param {Array} candidates 
 * @returns {Object|null}
 */
function findExactMatch(input, candidates) {
  if (!input || !candidates) return null;
  
  const inputNorm = normalizeString(input);
  // Bo'sh joylarsiz versiya ("mini medovik" → "minimedovik")
  const inputStripped = inputNorm.replace(/\s+/g, '');
  
  // To'liq aniq mos kelish (nom bilan)
  const exactMatch = candidates.find(candidate => {
    const name = normalizeString(candidate.name || candidate);
    return name === inputNorm;
  });
  
  if (exactMatch) return exactMatch;
  
  // Bo'sh joylarsiz aniq mos kelish ("MINIMEDOVIK" → "MINI MEDOVIK")
  const strippedMatch = candidates.find(candidate => {
    const name = normalizeString(candidate.name || candidate).replace(/\s+/g, '');
    return name === inputStripped;
  });
  
  if (strippedMatch) return strippedMatch;
  
  // So'z tartibi farq bo'lsa ham mos kelish ("MEDOVIK MINI" → "MINI MEDOVIK")
  const inputSorted = inputNorm.split(' ').sort().join(' ');
  const wordOrderMatch = candidates.find(candidate => {
    const name = normalizeString(candidate.name || candidate);
    return name.split(' ').sort().join(' ') === inputSorted;
  });
  
  if (wordOrderMatch) return wordOrderMatch;
  
  // Tags bo'yicha aniq mos kelish
  const tagMatch = candidates.find(candidate => {
    if (candidate.tags && Array.isArray(candidate.tags)) {
      return candidate.tags.some(tag => {
        const tagNorm = normalizeString(tag);
        return tagNorm === inputNorm || tagNorm.replace(/\s+/g, '') === inputStripped;
      });
    }
    return false;
  });
  
  if (tagMatch) return tagMatch;
  
  // partial match olib tashlandi - noto'g'ri natijalar berardi
  // ("minimedovik" ichida "medovik" bor → MEDOVIK ga mos deb hisoblardi)
  const partialMatch = null;
  
  return partialMatch;
}

/**
 * Tavsiyalar formatini yaratish
 * @param {Array} matches 
 * @param {string} type - 'branch' yoki 'product'
 * @returns {string}
 */
function formatSuggestions(matches, type = 'item') {
  if (!matches || matches.length === 0) {
    return '';
  }
  
  const header = type === 'branch' 
    ? '🏢 O\'xshash filiallar:'
    : '📦 O\'xshash mahsulotlar:';
  
  const suggestions = matches.map((match, index) => {
    const percentage = Math.round(match.similarity);
    const emoji = percentage >= 90 ? '✅' : percentage >= 70 ? '🔶' : '🔸';
    return `${emoji} ${index + 1}. ${match.name} (${percentage}% o'xshash)`;
  }).join('\n');
  
  return `${header}\n${suggestions}`;
}

/**
 * Smart matching - aniq yoki o'xshash topish
 * @param {string} input 
 * @param {Array} candidates 
 * @param {Object} options 
 * @returns {Object}
 */
function smartMatch(input, candidates, options = {}) {
  // Aniq mos kelishni tekshirish
  const exactMatch = findExactMatch(input, candidates);
  
  if (exactMatch) {
    return {
      type: 'exact',
      match: exactMatch,
      confidence: 100,
      suggestions: []
    };
  }
  
  // O'xshash variantlarni topish
  const similarMatches = findSimilarMatches(input, candidates, options);
  
  if (similarMatches.length === 0) {
    return {
      type: 'none',
      match: null,
      confidence: 0,
      suggestions: []
    };
  }
  
  // Eng yaqin variant juda o'xshash bo'lsa (70%+), uni taklif qilish
  const bestMatch = similarMatches[0];
  
  if (bestMatch.similarity >= (options.autoAcceptThreshold || 70)) {
    return {
      type: 'high-confidence',
      match: bestMatch.item,
      confidence: bestMatch.similarity,
      suggestions: similarMatches
    };
  }
  
  return {
    type: 'suggestions',
    match: null,
    confidence: bestMatch.similarity,
    suggestions: similarMatches
  };
}

module.exports = {
  normalizeString,
  calculatePartialMatch,
  levenshteinDistance,
  calculateSimilarity,
  findSimilarMatches,
  findExactMatch,
  formatSuggestions,
  smartMatch
};
