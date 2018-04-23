const fs    = require('fs');
const yauzl = require('yauzl');

const storage = require('@google-cloud/storage')();

const TEMPORARY_DIRECTORY = '/tmp/';
const DEST_BUCKET_NAME    = 'mtg-card-recognition-images-to-batch';

//these must be global for localFileToBucketWithBatchingMetadata to work
const destBucket = storage.bucket(DEST_BUCKET_NAME);

let batchSize;
let zipPath;

exports.unzip = (event) => {
  const bucketEvent = event.data;

  const sourceBucket = storage.bucket(bucketEvent.bucket);
  const sourceFile   = sourceBucket.file(bucketEvent.name);

  let metadata;

  return sourceFile.getMetadata().then((data) => {
    metadata  = data[0];
    batchSize = metadata.metadata.batchSize;
    
    if (!batchSize) {
      throw new Error('Object ' + bucketEvent.name + ' missing \'batchSize\' metadata attribute');
    }
    
    let zipFilename = bucketEvent.name;
    zipPath         = TEMPORARY_DIRECTORY + zipFilename;
      
    return sourceFile.download({destination: zipPath});
  }).then(() => {
    return unzipFileByFile(zipPath,localFileToBucketWithBatchingMetadata);
  }).catch((err) => {
    console.error(err);
  });
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
          let destinationPath = TEMPORARY_DIRECTORY + entry.fileName;
          filenames.push(destinationPath);
          
          zipFile.openReadStream(entry, (err, readStream) => {
            if (err) throw err;
            readStream.on('end', () => {
              //provide the callback promise with the current filename, list of all filenames up to that point, and the final number
              //you may only need the current filename
              onFileUnzipPromise(destinationPath,filenames,zipFile.entryCount).then(() => {
                zipFile.readEntry();
              });
            });
                    
            readStream.pipe(fs.createWriteStream(destinationPath));
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
  if (batchSize<1 || !Number.isInteger(batchSize)) {
    throw new Error('Batch size must be a positive integer in order to set batch image metadata');
  }
  
  let destFilename = filename.split('/')[filename.split('/').length-1];
  
  let destFilenames = [];
  for (let i=0;i<filenames.length;i++) {
    destFilenames.push(filenames[i].split('/')[filenames[i].split('/').length-1]);
  }
    
  let index = filenames.length-1;
  if ((index%batchSize==0 && (index!=0 || batchSize==1)) || index==totalCount-1) {
    let nonTriggerOriginalFilenames = filenames.slice(index-(batchSize-1),index);
    let nonTriggerFiles             = destFilenames.slice(index-(batchSize-1),index);
    let batchFiles                  = [destFilename];
    batchFiles.push(...nonTriggerFiles);

    let triggerFileUploadOptions = {destination: destFilename, metadata: {metadata: {batchFilenames: JSON.stringify(batchFiles)}}};
    
    let nonTriggerFileUploads = [];
    for (let i=0;i<nonTriggerFiles.length;i++) {
      nonTriggerFileUploads.push(new Promise((resolve,reject) => {
        destBucket.upload(nonTriggerOriginalFilenames[i],{destination: nonTriggerFiles[i]}).then(() => {
          resolve();
        });
      }));
    }
    
    return Promise.all(nonTriggerFileUploads).then(() => {
      return destBucket.upload(filename,triggerFileUploadOptions);
    });
  } else {
    return Promise.resolve();
  }
}