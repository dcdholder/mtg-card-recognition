global.Promise=require('bluebird');

const fs = require('fs');

const storage = require('@google-cloud/storage')();

const Jimp = require('jimp');

const MAX_BATCHED_SIZE = 10 * 1024 * 1024;

const TEMPORARY_DIRECTORY = '/tmp/';

const SOURCE_BUCKET_NAME = 'mtg-card-recognition-images-to-batch';
const sourceBucket       = storage.bucket(SOURCE_BUCKET_NAME); 

const DEST_BUCKET_NAME = 'mtg-card-recognition-images';
const destBucket       = storage.bucket(DEST_BUCKET_NAME);

let imageData;

//operates purely on bucket file metadata
exports.batcher = (event) => {
  const pubsubData = event.data; //TODO: deserialize?  
  imageData        = JSON.parse(Buffer.from(pubsubData.data, 'base64').toString());
  
  return downloadBatchFiles(imageData.filenames).then((batchFilePaths) => {
    return getDimensionsOfImages(batchFilePaths);
  }).then((dimensionsOfImages) => {
    return resizeImagesToCommonDimensions(dimensionsOfImages);
  }).then(([filePathsToBatch,dimensions]) => {
    return stitchImageBatch(filePathsToBatch,dimensions);
  }).then(([batchedImagePath,dimensions]) => {
    return reduceQualityToFileSize(batchedImagePath,MAX_BATCHED_SIZE,dimensions);
  }).then(([batchedImagePath,dimensions]) => {
    return uploadWithImageMetadata(batchedImagePath,dimensions); //TODO: metadata needs to include original file IDs
  });
}

//TODO: this should actually do something lol
function reduceQualityToFileSize(batchedImagePath,desiredFileSize,dimensions) {
  return Promise.resolve([batchedImagePath,dimensions]);
}

function getBatchFilenames() {  
  return sourceFile.getMetadata().then((data) => {
    const metadata = data[0].metadata;
    
    if (!metadata) {return Promise.resolve([]);} //covers the case where absolutely no custom metadata exists for the object
    
    const batchFilenames = metadata.batchFilenames; //will be empty if file isn't a "trigger" file with metadata specifying the other files in the batch
    
    return (typeof batchFilenames !== 'undefined') ? Promise.resolve(JSON.parse(batchFilenames)) : Promise.resolve([]);
  });
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
    return Promise.resolve([Object.keys(dimensions),maxDimensions]);
  });
}

function uploadWithImageMetadata(sourcePath,dimensions) {
  let destFilename = sourcePath.split('/')[sourcePath.split('/').length-1];
  
  return destBucket.upload(sourcePath,{destination: destFilename, metadata: {metadata: {width: dimensions.x, height: dimensions.y}}});
}

function stitchImageBatch(filenames,dimensions) {
  let stitchedImageFilename = filenames[0] + '-stitched.jpg';
  
  let individualImageWidth  = dimensions.x;
  let individualImageHeight = dimensions.y;
  
  const resizedImages = {};
  return Promise.each(filenames, (filePath) => {
    return Jimp.read(filePath).then((image) => {
      resizedImages[filePath] = image;
      
      return Promise.resolve();
    });
  }).then(() => {
    resizedImages[filenames[0]].contain(individualImageWidth*filenames.length,individualImageHeight,Jimp.HORIZONTAL_ALIGN_LEFT);
    
    return Promise.resolve(resizedImages[filenames[0]]);
  }).then((stitchedImage) => { //create room in the final image to overlay with component images
    const imageCompositePromises = [];
    for (let i=1;i<filenames.length;i++) {
      let imageCompositePromise = new Promise((resolve,reject) => {
        stitchedImage.composite(resizedImages[filenames[i]],i*individualImageWidth,0);
        resolve();
      });
      
      imageCompositePromises.push(imageCompositePromise);
    }
    
    return Promise.each(imageCompositePromises, (imageCompositePromise) => {
      return imageCompositePromise;
    }).then(() => {
      return Promise.resolve(stitchedImage);
    });
  }).then((stitchedImage) => {
    stitchedImage.quality(90).write(stitchedImageFilename);
    
    return Promise.resolve();
  }).then(() => {
    return Promise.resolve([stitchedImageFilename,individualImageWidth*resizedImages.length]);
  });
}