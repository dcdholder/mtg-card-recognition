const fs = require('fs');

const storage = require('@google-cloud/storage')();
const pubsub  = require('@google-cloud/pubsub')();

const vision = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient();

const DEST_BUCKET_NAME = 'mtg-card-recognition-ocr';
const DEST_FILENAME    = 'card-text.json';
const LOCAL_PATH       = '/tmp/' + DEST_FILENAME;

const SCALING_FACTOR = 745;

const FIELDS = [
  {name: 'title',       vertices: [{x: 0.0733, y:0.0747}, {x: 0.9213, y:0.0747}, {x: 0.9213, y:0.1347}, {x: 0.0733, y:0.1347}]},
  {name: 'type',        vertices: [{x: 0.0733, y:0.7947}, {x: 0.9213, y:0.7947}, {x: 0.9213, y:0.8520}, {x: 0.0733, y:0.8520}]},
  {name: 'description', vertices: [{x: 0.0733, y:0.8827}, {x: 0.9213, y:0.8827}, {x: 0.9213, y:1.2493}, {x: 0.0733, y:1.2493}]}
]

exports.ocr = (event) => {  
  const blobData = event.data;
  
  const imageUri = 'gs://' + blobData.bucket + '/' + blobData.name;
  
  return client.textDetection(imageUri).then((results) => {
    const textAnnotations = results[0].textAnnotations;
    
	return recoverFieldText(textAnnotations);
  }).then((fieldContents) => {
    return new Promise((resolve,reject) => {
      fs.writeFile(LOCAL_PATH, JSON.stringify(fieldContents), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });    
  }).then(() => {
    const bucket = storage.bucket(DEST_BUCKET_NAME);
    
    return bucket.upload(LOCAL_PATH, {destination: DEST_FILENAME}); //upload image to destination bucket
  }).catch((err) => {
    console.error(err);
  });
}

function recoverFieldText(textAnnotations) {
  const lines = textAnnotations[0].description.split('\n');

  const firstWordIndex = [];

  console.log(lines);

  //find the indices of all the line-starting words in the full text block
  let previousLinesWordCount = 0;
  for (let i=0;i<lines.length-1;i++) { //the -1 is to remove the empty string generated by the final newline
    firstWordIndex.push(previousLinesWordCount);
    previousLinesWordCount += lines[i].split(' ').length;
  }

  console.log(firstWordIndex);

  //identify the bounding polys associated with each line-starting word (output is an array of the line-starting word bounding polys ordered by line number)
  const boundingPolys = [];
  for (let i=0;i<firstWordIndex.length;i++) {
    boundingPolys.push(textAnnotations[firstWordIndex[i]+1].boundingPoly.vertices);
  }


  console.log(boundingPolys);

  //identify the field which each line-starting word index belongs to
  const fieldLineIndices = {};
  for (let field of FIELDS) {
    fieldLineIndices[field.name] = [];
  }

  for (let i=0;i<boundingPolys.length;i++) {
    for (let field of FIELDS) {
      if (verticesInside(boundingPolys[i],field.vertices)) {
        fieldLineIndices[field.name].push(i);
      }
    }
  }

  console.log(fieldLineIndices);

  //sort line indices within each field 
  for (let fieldName in fieldLineIndices) {
    fieldLineIndices[fieldName].sort((a, b) => a-b);
  }

  console.log(fieldLineIndices);

  //recreate original field text from line array and recovered line indices
  const fieldContents = {};
  for (let fieldName in fieldLineIndices) {
    fieldContents[fieldName] = [];
    for (let lineIndex of fieldLineIndices[fieldName]) {
      fieldContents[fieldName].push(lines[lineIndex]);
    }
    fieldContents[fieldName] = fieldContents[fieldName].join(' ');
  }

  console.log(fieldContents);

  return Promise.resolve(fieldContents);
}

function verticesInside(verticesA, verticesB) {
  const center = {};
  
  center.x = Math.floor(verticesA[0].x + (verticesA[2].x-verticesA[0].x) / 2);
  center.y = Math.floor(verticesA[0].y + (verticesA[2].y-verticesA[0].y) / 2);
  
  return (center.x > verticesB[0].x*SCALING_FACTOR && center.x < verticesB[2].x*SCALING_FACTOR) && (center.y > verticesB[0].y*SCALING_FACTOR && center.y < verticesB[2].y*SCALING_FACTOR);
}