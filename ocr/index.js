const fs = require('fs');

const storage = require('@google-cloud/storage')();
const pubsub  = require('@google-cloud/pubsub')();

const vision  = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient();

const DEST_TOPIC_NAME = 'projects/dcdholder-personal/topics/ocr-output';

const CARD_ASPECT_RATIO = 1.4;

const FIELDS = [
  {name: 'name', vertices: [{x: 0.0733, y:0.0747}, {x: 0.9213, y:0.0747}, {x: 0.9213, y:0.1347}, {x: 0.0733, y:0.1347}]},
  //{name: 'type', vertices: [{x: 0.0733, y:0.7947}, {x: 0.9213, y:0.7947}, {x: 0.9213, y:0.8520}, {x: 0.0733, y:0.8520}]},
  {name: 'text', vertices: [{x: 0.0733, y:0.8827}, {x: 0.9213, y:0.8827}, {x: 0.9213, y:1.2493}, {x: 0.0733, y:1.2493}]}
]

let sourceFile;

exports.ocr = (event) => {  
  const bucketEvent  = event.data;
  const sourceBucket = storage.bucket(bucketEvent.bucket);
  sourceFile         = sourceBucket.file(bucketEvent.name);
  
  const imageUri = 'gs://' + bucketEvent.bucket + '/' + bucketEvent.name;
  
  let numCards;
  let cardWidth;
  
  return getImageDimensions().then((dimensions) => {    
    cardWidth = dimensions.height / CARD_ASPECT_RATIO;
    numCards  = Math.round(dimensions.width / cardWidth);
    
    return client.textDetection(imageUri);
  }).then((results) => {
    const textAnnotations = results[0].textAnnotations;
    
    return recoverFieldText(textAnnotations,numCards,cardWidth);
  }).then((fieldContents) => {
    const topic     = pubsub.topic(DEST_TOPIC_NAME);
    const publisher = topic.publisher();
  
    console.log(fieldContents);
  
    const publishPromises = [];
    for (let i=0;i<numCards;i++) {
      let payload = {id: bucketEvent.name + '-' + i, fields: fieldContents[i]};
    
      let dataBuffer = Buffer.from(JSON.stringify(payload));
    
      let publishPromise = 
      publishPromises.push(() => {
        return publisher.publish(dataBuffer).then(() => {
          console.log(payload);
        });
      });
    }
    
    return Promise.all(publishPromises);
  }).catch((err) => {
    console.error(err);
  });
}

function getImageDimensions() {  
  return sourceFile.getMetadata().then((data) => {
    const metadata = data[0].metadata;
    
    if (!metadata) { //covers the case where absolutely no custom metadata exists for the object
      throw new Error('Could not retrieve any custom metadata');
    }
    
    const height = metadata.height;
    const width  = metadata.width;
    
    return (typeof height !== 'undefined' || typeof width !== 'undefined') ? Promise.resolve({height: height, width: width}) : Promise.reject('Could not retrieve dimensions metadata');
  });
}

function recoverFieldText(textAnnotations,cardNum,cardWidth) {
  //strip out any unicode
  const strippedAnnotations = [];
  for (let i=0; i<textAnnotations.length; i++) {
	strippedAnnotations.push(textAnnotations[i]);
    strippedAnnotations[i].description = strippedAnnotations[i].description.replace(/[^\x00-\x7F]/g, "");
  }
  
  const lines = strippedAnnotations[0].description.split('\n');

  const firstWordIndex = [];

  //find the indices of all the line-starting words in the full text block
  let previousLinesWordCount = 0;
  for (let i=0;i<lines.length-1;i++) { //the -1 is to remove the empty string generated by the final newline
    firstWordIndex.push(previousLinesWordCount);
    previousLinesWordCount += lines[i].split(' ').length;
  }

  //identify the bounding polys associated with each line-starting word (output is an array of the line-starting word bounding polys ordered by line number)
  const boundingPolys = [];
  for (let i=0;i<firstWordIndex.length;i++) {
    boundingPolys.push(strippedAnnotations[firstWordIndex[i]+1].boundingPoly.vertices);
  }

  //identify the field which each line-starting word index belongs to
  const fieldLineIndices = {};
  for (let i=0;i<cardNum;i++) {
    fieldLineIndices[i] = {};
    for (let field of FIELDS) {
      fieldLineIndices[i][field.name] = [];
    }
  }

  for (let j=0;j<boundingPolys.length;j++) {
    for (let i=0;i<cardNum;i++) {
      for (let field of FIELDS) {
        if (verticesInside(boundingPolys[j],field.vertices,i,cardWidth)) {
          fieldLineIndices[i][field.name].push(j);
        }
      }
    }
  }

  //sort line indices within each field
  for (let i=0;i<cardNum;i++) {
    for (let fieldName in fieldLineIndices[i]) {
      fieldLineIndices[i][fieldName].sort((a, b) => a-b);
    }
  }

  //recreate original field text from line array and recovered line indices
  const fieldContents = {};
  for (let i=0;i<cardNum;i++) {
    fieldContents[i] = {};
    for (let fieldName in fieldLineIndices[i]) {
      fieldContents[i][fieldName] = [];
      for (let lineIndex of fieldLineIndices[i][fieldName]) {
        fieldContents[i][fieldName].push(lines[lineIndex]);
      }
      fieldContents[i][fieldName] = fieldContents[i][fieldName].join(' ');
    }
  }

  return Promise.resolve(fieldContents);
}

function verticesInside(verticesA, verticesB, cardNum, cardWidth) {
  const center = {};
  
  center.x = Math.floor(verticesA[0].x + (verticesA[2].x-verticesA[0].x) / 2);
  center.y = Math.floor(verticesA[0].y + (verticesA[2].y-verticesA[0].y) / 2);
  
  return (center.x > (verticesB[0].x+cardNum)*cardWidth && center.x < (verticesB[2].x+cardNum)*cardWidth) && (center.y > verticesB[0].y*cardWidth && center.y < verticesB[2].y*cardWidth);
}