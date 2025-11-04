// utils.js
// helper functions: computeFeedback(secret, guess)
// secret and guess are strings like "1234"

function computeFeedback(secret, guess) {
  // validate lengths
  if (typeof secret !== 'string' || typeof guess !== 'string') {
    throw new Error('secret and guess must be strings');
  }
  if (secret.length !== guess.length) {
    throw new Error('secret and guess must have same length');
  }

  let correctPosition = 0;
  const secretCounts = {}; // counts of digits not matched in correct pos
  const guessCounts = {}; // counts of digits not matched in correct pos

  // first pass: count correct positions and collect leftover digits
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i];
    const g = guess[i];
    if (s === g) {
      correctPosition++;
    } else {
      secretCounts[s] = (secretCounts[s] || 0) + 1;
      guessCounts[g] = (guessCounts[g] || 0) + 1;
    }
  }

  // compute correct number (right digit, wrong position)
  let correctNumber = 0;
  for (const digit in guessCounts) {
    if (secretCounts[digit]) {
      correctNumber += Math.min(secretCounts[digit], guessCounts[digit]);
    }
  }

  return { correctPosition, correctNumber };
}

function makeId(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude ambiguous
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

module.exports = { computeFeedback, makeId };
