const ds = require('@google-cloud/datastore')();

exports.identifier = (event) => {
  const pubsubData = event.data;
  const data       = JSON.parse(Buffer.from(pubsubData.data, 'base64').toString());
  
  const identifiedCardId = identification(data.fields);
  
  return recordCardIdentification(data.id,identifiedCardId);
}

function recordCardIdentification(cardId) {
  //TODO: add some datastore bullshit in here
}

//TODO: could be a little more sophisticated...
function identification(fieldContents) {
  const cardIdCount = {};
  for (let field of fieldContents) {
    let mostCommonCardId = fieldContents[field][0];
    cardIdCount[mostCommonCardId] = (wordFrequencies[mostCommonCardId] || 0) + 1;
  }
  
  let maxCount = 0;
  let maxCountCardId;
  for (let cardId in cardIdCount) {
    if (cardIdCount>maxCount) {
      maxCount       = cardIdCount[cardId];
      maxCountCardId = cardId;
    }
  }
  
  return maxCountCardId;
}