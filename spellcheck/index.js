const allCards = require('./AllCards.json');

exports.wordBagSpellcheck = (req,res) => {
  if (req.body.fieldsDetected === undefined) {
    res.status(400).send('A required parameter is undefined');
  } else {
    const closestMatches = matchFieldContentsToCardIds(req.body.fieldsDetected,allCards);
    res.status(200).send(closestMatches);
  }
}

function matchFieldContentsToCardIds(fieldsDetected,fieldsCanonical) {
  //re-key fieldsCanonical into a form ingestible by textBlockIdsByWordBagSimilarityScore
  const fieldsCanonicalByField = {};
  for (let fieldId in fieldsDetected) {
    fieldsCanonicalByField[fieldId] = {};
  }
  
  for (let cardId in fieldsCanonical) {
    for (let fieldId in fieldsDetected) {
      if (fieldsCanonical[cardId][fieldId]) {
        fieldsCanonicalByField[fieldId][cardId] = fieldsCanonical[cardId][fieldId];
      } else {
        fieldsCanonicalByField[fieldId][cardId] = ""; //needed for cards like "Island", which do not have a description field
      }
    }
  }
  
  //run all cards through the ringer on a per-field basis
  const closestMatches = {};
  for (let field in fieldsDetected) {
    closestMatches[field] = textBlockIdsByWordBagSimilarityScore(fieldsDetected[field],fieldsCanonicalByField[field]);
  }
  
  return closestMatches;
}

function getWordFrequencies(text) {
  const words = text.trim().split(/\s+/);
  
  const wordFrequencies = {};
  words.forEach((word) => {
    wordFrequencies[word] = (wordFrequencies[word] || 0) + 1;
  });
  
  return wordFrequencies;
}

function getCanonicalFrequencies(canonicalTexts) {
  const frequencies = {};
  
  for (let textBlockId in canonicalTexts) {
    frequencies[textBlockId] = getWordFrequencies(canonicalTexts[textBlockId]);
  }
  
  return frequencies;
}

function textBlockIdsByWordBagSimilarityScore(text,canonicalTexts) {
  let frequencyDeltaScoreWeightedSum = {};
  
  let frequenciesActual    = getWordFrequencies(text);
  let frequenciesCanonical = getCanonicalFrequencies(canonicalTexts);
  
  //compute the "total similarity score" between the text excerpt and all possible canonical texts
  for (let textBlockId in frequenciesCanonical) {    
    let frequencyDeltaScore = {};
    let scoreMultiplier     = {};
    
    //handles any word which was detected in the actual text, including those which do not occur in the canonical text
    for (let word in frequenciesActual) {
      if (word in frequenciesCanonical[textBlockId]) {
        let frequencyCanonical = frequenciesCanonical[textBlockId][word];
        let frequencyActual    = frequenciesActual[word];

        let frequencyDelta        = Math.abs(frequencyCanonical - frequencyActual);
        frequencyDeltaScore[word] = frequencyDelta / (frequencyCanonical + frequencyActual);
      } else {
        frequencyDeltaScore[word] = 1;
      }
      
      scoreMultiplier[word] = frequenciesActual[word];
    }
    
    //handles any word which was not detected in the actual text, but present in the canonical text is automatically assigned a score of 1
    //words that are "missing" thereby add to the total score
    for (let word in frequenciesCanonical[textBlockId]) {
      if (!(word in frequenciesActual)) {
        frequencyDeltaScore[word] = 1;
        scoreMultiplier[word]     = frequenciesCanonical[textBlockId][word];
      }
    }
    
    frequencyDeltaScoreWeightedSum[textBlockId] = 0;
    for (let word in frequencyDeltaScore) {
      frequencyDeltaScoreWeightedSum[textBlockId] += frequencyDeltaScore[word] * scoreMultiplier[word];
    }
  }
  
  //return an array of canonical text IDs ordered by similarity to the presented text
  let textBlockIdsBySimilarityScore = Object.keys(canonicalTexts);
  textBlockIdsBySimilarityScore.sort((a,b) => frequencyDeltaScoreWeightedSum[a] - frequencyDeltaScoreWeightedSum[b]);
  
  return textBlockIdsBySimilarityScore;
}