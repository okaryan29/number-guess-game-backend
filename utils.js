export function checkGuess(secret, guess) {
  let correctPosition = 0;
  let correctNumber = 0;

  const secretArr = secret.split("");
  const guessArr = guess.split("");

  // Correct positions
  for (let i = 0; i < 4; i++) {
    if (secretArr[i] === guessArr[i]) {
      correctPosition++;
      secretArr[i] = null;
      guessArr[i] = null;
    }
  }

  // Correct numbers (wrong position)
  for (let i = 0; i < 4; i++) {
    if (guessArr[i] && secretArr.includes(guessArr[i])) {
      correctNumber++;
      secretArr[secretArr.indexOf(guessArr[i])] = null;
    }
  }

  return { correctPosition, correctNumber };
}
