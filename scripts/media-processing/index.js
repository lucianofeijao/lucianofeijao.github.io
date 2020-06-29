const ImageSizer = require('./image-sizer');
const path = require('path');

const dataDir = path.join(__dirname, '../../data/');
const tmpDir = path.join(__dirname, '../../tmp/');

const sizer = new ImageSizer({
  widths: [180, 300, 460, 720, 1050, 1440, 2000],
  standardQuality: 80,
  retinaQuality: 80,
  mediaFolderPath: path.join(__dirname, '../../assets/images/'),
  publicDataPath: dataDir + 'imagedata.json',
  privateDataPath: tmpDir + 'imagedata.json',
  publishDir: path.join(__dirname, '../../static/images/'),  
});