global.Promise=require('bluebird');

const fs = require('fs');

const storage = require('@google-cloud/storage')();

const Jimp = require('jimp');

const MAX_BATCHED_SIZE = 10 * 1024 * 1024;

let bucketEvent;
let sourceBucket;
let sourceFile;

//operates purely on bucket file metadata
exports.imageBatcher = function imageBatcher(event) {
  bucketEvent = event.data;

  sourceBucket = storage.bucket(bucketEvent.bucket);
  sourceFile   = sourceBucket.file(bucketEvent.name);
  
  return getBatchFilenames(event).then((batchFilenames) => {
    if (batchFilenames.length!=0) {
      return downloadBatchFiles(batchFilenames).then((batchFilePaths) => {
        return getDimensionsOfImages(batchFilePaths);
      }).then((dimensionsOfImages) => {
        return resizeImagesToCommonDimensions(dimensionsOfImages);
      }).then((filePathsToBatch) => {
        return stitchImageBatch(filePathsToBatch);
      }).then((batchedImagePath) => {
        return reduceQualityToFileSize(batchedImagePath,MAX_BATCHED_SIZE);
      }).then((batchedImagePath) => {
        return uploadWithImageMetadata(batchedImagePath); //TODO: metadata needs to include original file IDs
      });
    } else {
      return Promise.resolve(); //do nothing if uploaded file isn't a "trigger" file
    }
  }
}

//TODO: this should actually do something lol
function reduceQualityToFileSize(batchedImagePath,desiredFileSize) {
  return batchedImagePath;
}

function getBatchFilenames() {  
  return sourceFile.getMetadata().then((data) => {
    const metadata       = data[0];
    const batchFilenames = metadata.metadata.batchFilenames; //will be empty if file isn't a "trigger" file with metadata specifying the other files in the batch
    
    return (typeof variable === 'undefined') ? Promise.resolve(batchFilenames) : Promise.resolve([]);
  }
}

function downloadBatchFiles(filenames) {
  const destPaths          = [];
  const batchFileDownloads = [];
  
  for (let filename of filenames) {
    let batchFile = sourceBucket.file(filename);
  
    let destPath = TEMPORARY_DIRECTORY + filename;
    destPaths.push(destPath);
  
    batchFileDownloads.push(new Promise((resolve,reject) => {
      batchFile.download({destination: destPath}).then(() => {resolve();});
    }));
  }
  
  return Promise.all(batchFileDownloads).then(() => {
    return Promise.resolve(destPaths);
  });
}

function getDimensionsOfImages(filePaths) {
  const dimensions = {};
  return Promise.each(filePaths, (filePath) => {
    return Jimp.read(filePath).then((image) => {
      dimensions[filePath] = {};
      
      dimensions[filePath].y = image.bitmap.height;
      dimensions[filePath].x = image.bitmap.width;
    });
  }).then(() => {
    return Promise.resolve(dimensions);
  });
}

function resizeImagesToCommonDimensions(dimensions) {
  //use the image with the maximum vertical dimension as the reference for the "largest"
  let maxHeight = 0;
  let maxHeightPath;
  for (let filePath in dimensions) {
    if (dimensions[filePath].y>maxHeight) {
      maxHeight     = dimensions[filePath].y;
      maxHeightPath = filePath;
    }
  }
  
  let maxDimensions = {};
  maxDimensions.x = dimensions[maxHeightPath].x;
  maxDimensions.y = dimensions[maxHeightPath].y;
  
  return Promise.each(Object.keys(dimensions), (filePath) => {
    return Jimp.read(filePath).then((image) => {
      image.resize(maxDimensions.x,maxDimensions.y).write(filePath);
    });
  }).then(() => {
    return Promise.resolve(Object.keys(dimensions));
  });
}

function uploadWithImageMetadata(sourcePath,destFilename,dimensions) {
  return upload(sourcePath,{destination: destFilename, metadata: {metadata: {width: dimensions.x, height: dimensions.y}}});
}

function stitchImages(resizedImages) {
  let stitchedImageFilename = '/tmp/final.jpg';
  
  let individualImageWidth = whatever; //TODO: figure this shit out
  let rightPaddingWidth    = (Object.keys(resizedImages).length-1) * individualImageWidth;
  
  let filenames = Object.keys(resizedImages);
  return resizedImages[filenames[0]].extend({right: rightPaddingWidth}).then((stitchedImage) => { //create room in the final image to overlay with component images
    return stitchImagesToStrip(stitchedImage,resizedImages,filenames,individualImageWidth,1);
  }).then((stitchedImage) => {
    return stitchedImage.jpg(stitchedImageFilename); //TODO: am I doing this right?
  }).then(() => {
    return Promise.resolve(stitchedImageFilename,filenames);
  });
}

//recursively pastes images from left to right on strip until it runs out of images
function stitchImagesToStrip(stitchedImageStrip,resizedImages,filenames,imageWidth,index) {
  return stitchedImageStrip.overlayWith(resizedImages[filenames[index]], {left: imageWidth*index}).then((stitchedImage) => {
    if (index==filenames.length-1) {
      return Promise.resolve(stitchedImage);
    } else {
      return stitchImagesToStrip(stitchedImage,resizedImages,filenames,imageWidth,index+1);
    }
  });
}