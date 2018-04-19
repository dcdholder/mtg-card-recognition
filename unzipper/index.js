const fs    = require('fs');
const yauzl = require('yauzl');

const storage = require('@google-cloud/storage')();

const TEMPORARY_DIRECTORY = '/tmp/';
const DEST_BUCKET_NAME    = 'mtg-card-recognition-batchable-images';

exports.zipper = (event) => {
  const bucketEvent = event.data;
  
  const sourceBucket = storage.bucket(bucketEvent.bucket);
  const sourceFile   = sourceBucket.file(bucketEvent.name);

  const metadata;
  const batchSize;

  return sourceFile.getMetadata().then(function(data) {
    metadata  = data[0];
    batchSize = metadata.batchSize;
    
    let zipFilename = bucketEvent.name;
    
    return unzip(zipFilename);
  }).then((imageFilenames) => {
    return localFilesToBucketWithBatchingMetadata(imageFilenames,DEST_BUCKET_NAME,batchSize);
  });
}

function unzip(zipFilename) {
  return new Promise((resolve,reject) => {
    const filenames = [];
    yauzl.open(zipFilename, {lazyEntries: true}, (err, zipFile) => {
      if (err) throw err;
      
      const imageFilenames = [];
      
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (/\//.test(entry.fileName)) {
          throw new Error('Cannot read from nested directories');
        } else {
          let destinationFilename = TEMPORARY_DIRECTORY + entry.fileName;
          imageFilenames.push(destinationFilename);
          
          zipFile.openReadStream(entry, (err, readStream) => {
            if (err) throw err;
            readStream.on('end', () => {
              zipFile.readEntry();
            });
                    
            readStream.pipe(fs.createWriteStream(destinationFilename));
          });
        }
      });
      
      zipFile.on('end', () => {
        resolve(imageFilenames);
      });
    });
  });
}

//upload files to bucket one at a time, setting batching metadata once for every ${batchSize} files
//files to be batched should always be present in the bucket when batching metadata is set on an image
function localFilesToBucketWithBatchingMetadata(filenames,destBucketName,batchSize) {  
  const destBucket = gcs.bucket(DEST_BUCKET_NAME);
  
  let   i              = 0;
  const batchFilenames = [];
  return Promise.each(filenames, (filename) => {
    batchFilenames.push(filename);
    if (i%batchSize==0 || i==filenames.length-1) {
      uploadOptions  = {destination: filename, metadata: {batchFilenames: batchFilenames}};
      batchFilenames = [];
    } else {
      uploadOptions = {destination: filename};
    }
    
    i++;
    
    return destBucket.upload(filename, uploadOptions);
  });
}