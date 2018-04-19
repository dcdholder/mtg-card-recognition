const fs    = require('fs');
const yauzl = require('yauzl');

const storage = require('@google-cloud/storage')();

const TEMPORARY_DIRECTORY = '/tmp/';
const DEST_BUCKET_NAME    = 'mtg-card-recognition-batchable-images';

//these must be global for localFileToBucketWithBatchingMetadata to work
const destBucket = gcs.bucket(DEST_BUCKET_NAME);
const batchSize;

exports.zipper = (event) => {
  const bucketEvent = event.data;
    
  if(bucketEvent.resourceState === 'exists' && bucketEvent.metageneration === 1) { //run only on source object creation
    const sourceBucket = storage.bucket(bucketEvent.bucket);
    const sourceFile   = sourceBucket.file(bucketEvent.name);

    const metadata;

    return sourceFile.getMetadata().then(function(data) {
      metadata  = data[0];
      batchSize = metadata.batchSize;
      
      let zipFilename = bucketEvent.name;
      
      return sourceFile.download({destination: zipFilename});
    }).then(() => {
      return unzipFileByFile(zipFilename,localFileToBucketWithBatchingMetadata);
    });
  }
}

function unzipFileByFile(zipFilename, onFileUnzipPromise) {
  return new Promise((resolve,reject) => {
    const filenames = [];
    yauzl.open(zipFilename, {lazyEntries: true}, (err, zipFile) => {
      if (err) throw err;
      
      let entryIndex = 0;
      
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (/\//.test(entry.fileName)) {
          throw new Error('Cannot read from nested directories');
        } else {
          let destinationFilename = TEMPORARY_DIRECTORY + entry.fileName;
          filenames.push(destinationFilename);
          
          zipFile.openReadStream(entry, (err, readStream) => {
            if (err) throw err;
            readStream.on('end', () => {
              //provide the callback promise with the current filename, list of all filenames up to that point, and the final number
              //you may only need the current filename
              onFileUnzipPromise(destinationFilename,filenames,zipFile.entryCount).then(() => {
                zipFile.readEntry();
              });
            });
                    
            readStream.pipe(fs.createWriteStream(destinationFilename));
          });
        }
      });
      
      zipFile.on('end', () => {
        resolve(filenames);
      });
    });
  });
}

//allows files to be uploaded with proper batching metadata in an ONLINE way
//do not need to wait for all files to be unzipped before we can begin transferring them over
//TODO: Is the dependence on global variables really a concern? They are static, after all
//TODO: delete files after you've moved them -- could save almost 50% memory
function localFileToBucketWithBatchingMetadata(filename,filenames,totalCount) {  
  let index = filenames.length-1;
  if (index%batchSize==0 || index==totalCount-1) {
    let batchFilenames = filenames.slice(index-(batchSize-1),index+1);
    
    uploadOptions  = {destination: filename, metadata: {batchFilenames: batchFilenames}};
    batchFilenames = [];
  } else {
    uploadOptions = {destination: filename};
  }
  
  return destBucket.upload(filename, uploadOptions);
}