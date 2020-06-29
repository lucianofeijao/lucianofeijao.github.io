const downloadData = require('./downloadData');
const parseArchieML = require('./parseArchieML');

const docId = '1amhKi_wlVlVDf5zix9S1xCTwF2qP53HVhUildNTtsyc';
downloadData.init(docId, (data) => {
  console.log(parseArchieML.init(data));  
})

function saveDocAsJson() {

}

