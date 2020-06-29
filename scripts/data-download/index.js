const fs = require('fs');
const path = require('path');
const downloadData = require('./downloadData');
const parseArchieML = require('./parseArchieML');

const filename = 'doc.json';
const dataDir = path.join(__dirname, `../../data/${filename}`);
const docId = '1amhKi_wlVlVDf5zix9S1xCTwF2qP53HVhUildNTtsyc';

downloadData.init(docId, (data) => {
  const parsed = parseArchieML.init(data);
  const doc = JSON.stringify(parsed, null, 2);
  
  fs.writeFile(dataDir, doc, function (err) {
    if (err) return console.log(err);
    console.log(`Saved data to ${dataDir}`);
  });
})