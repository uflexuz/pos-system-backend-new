/**
 * Promise'ni belgilangan vaqt ichida bajarilishga majburlaydi.
 * DB so'rovi osilib qolsa (reverse-proxy 502 berishidan oldin) toza xato tashlaydi.
 *
 * @param {Promise} promise  - kuzatiladigan promise
 * @param {number} ms        - millisekundlarda timeout
 * @param {string} label     - xato xabarida ko'rsatiladigan nom
 * @returns {Promise} natija yoki TimeoutError
 */
function withTimeout(promise, ms = 8000, label = "operatsiya") {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label}: ${ms}ms ichida javob bermadi (timeout)`);
      err.code = "ETIMEDOUT";
      err.isTimeout = true;
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
