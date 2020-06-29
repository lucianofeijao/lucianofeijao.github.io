'use strict';
const _ = require('lodash');
const fs = require('fs');
const EventEmitter = require('events');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const path = require('path');
const queue = require('queue-async');
const crypto = require('crypto');
const winston = require('winston');
const slugify = require('slug');

const dataDir = path.join(__dirname, '../../data/');
const tmpDir = path.join(__dirname, '../../tmp/');
const EventNS = 'MediaManager';

/**
 * Given a folder path and array of desired file types, 
 * return an array of metadata about the found files. 
 * 
 * @param {String} folderPath 
 * @param {Array} fileExtensions 
 */
function getFilesInFolder(folderPath, fileExtensions) {
  return fs.readdirSync(folderPath, 'utf-8').filter(function (file) {

    //lowercase all valid file extensions
    fileExtensions = fileExtensions.map((name) => name.toLowerCase());

    //lowercase filename so any variation in valid extension is valid, eg: .JPG and .jpg 
    file = file.toLowerCase();

    // Use constructor regex so we can form with dynamic string. same as literal: /.(jpg|png)$/ 
    const fileTypesAsRegexOr = fileExtensions.join('|');
    const re = new RegExp('.(' + fileTypesAsRegexOr + ')$');
    return re.test(file);
  }).map(function (fileName) {
    const filePath = folderPath + fileName;

    // a web-friendly slug. 
    // We support special characters and spacers in
    // file names in assets/ and in google docs,
    // but the slug is is compatible with our CDNs and web stack.
    const slug = slugify(path.basename(filePath, path.extname(filePath)), { lower: true });

    return {
      // public data for client use in data/imagedata.json     
      publicData: {
        slug,
        extension: path.extname(filePath).replace('.', '')
      },

      // not to be passed to client/public data/imagedata.json
      privateData: {
        srcFolderPath: folderPath,
        srcFileName: fileName,
        srcFilePath: filePath
      }
    };
  });
}

/**
 * Return a MD5 has of a given file. We use these
 * hashes to check for changes in source files.
 * @param {String} path 
 */
function getFileHash(path) {
  const md5 = execSync('openssl md5 "' + path + '" | cut -d "=" -f 2');
  return md5.toString('utf8').trim();
}


class MediaManager extends EventEmitter {
  constructor(options) {
    super();
    const self = this;

    this.options = _.extend({
      validSourceExts: ['jpg', 'png'],
      mediaFolderPath: path.join(__dirname, '../../assets/images/'),
      forceTask: false, // run task, even if standard test says it doesn't need to run.
      publicDataPath: dataDir + 'mediadata.json', // optional
      privateDataPath: tmpDir + 'mediadata.json', // optional. this is the cache. so it's a good idea to have it.
      dependencies: [], // list of external dependencies needed to run tasks
      numberOfConcurrentTask: 1, // maybe?: os.cpus().length - 1
      logging: 'info' // verbose or info
    }, options || {});

    self._logger = winston.createLogger({
      transports: [
        new (winston.transports.Console)({
          level: options.logging ? options.logging : 'info'
        })
      ]
    });

    // exit from app if any missing OS/system dependencies. 
    const missingDependencies = this.findMissingDependencies();
    if (missingDependencies.length > 0) {
      const message = missingDependencies.length > 1 ? 'dependencies' : 'dependency';
      console.log(`Error. Missing ${message} must be installed.`);
      missingDependencies.forEach(function (missingDependency) {
        console.log(missingDependency);
      });
      return;
    }

    // pass through to instances
    this.execSync = execSync;
    this.taskQueue = queue(this.options.numberOfConcurrentTask);

    // all requested task, even if we don't run them b/c
    // our test in `addTask()` show we already have
    // an oputout for the given input
    this.allTasks = [];

    // task that truly need running because they fail 
    // the test `addTask()` method, meaning we don't have 
    // an output for the given input.
    this.neededTasks = [];

    this.publicData = this.options.publicDataPath && fs.existsSync(this.options.publicDataPath) ? JSON.parse(fs.readFileSync(this.options.publicDataPath, 'utf8')) : {};
    this.privateData = this.options.privateDataPath && fs.existsSync(this.options.privateDataPath) ? JSON.parse(fs.readFileSync(this.options.privateDataPath, 'utf8')) : {};

    // cache metadata about all source files in source folder
    const srcFiles = getFilesInFolder(self.options.mediaFolderPath, self.options.validSourceExts);

    //
    // Create public record about each source file. 
    // This is the basis for data/imagedata.json, which 
    // only includes public-friendly data, like image slug,
    // extension and available sizes. 
    //
    this.sourcePublicData = srcFiles.map(function (fileMetaObj) {
      let { publicData } = _.extend({}, fileMetaObj);

      // merge in existing public metadata
      const prexistingData = _.find(self.publicData, { slug: publicData.slug });
      if (prexistingData) publicData = _.extend(prexistingData, publicData);
      return publicData;
    });

    // 
    // Create private record of each source file.
    // This can include non-public information like
    // local machine file paths.
    //

    this.sourcePrivateData = srcFiles.map(function (fileMetaObj) {
      const { publicData, privateData } = _.extend({}, fileMetaObj);
      return _.extend({}, privateData, {
        slug: publicData.slug,
        srcFileHash: getFileHash(privateData.srcFilePath)
      });
    });

    //
    // Notify instances that object is ready 
    // for tasks.
    //
    _.defer(function () {
      this.emit(`${EventNS}:ready`, {
        media: self.getMetadata(),
        mediaFolderPath: self.options.mediaFolderPath
      });
    }.bind(this));
  }

  log(message) {
    this._logger.info(message);
  }

  getFilePathFromMeta(metaObj) {
    return this.getPrivateDataBySlug(metaObj.slug).srcFilePath;
  }

  getMetadata() {
    return this.sourcePublicData;
  }

  getMetadataBySlug(slug) {
    return _.find(this.getMetadata(), { slug: slug });
  }

  getPrivateData() {
    return this.sourcePrivateData;
  }

  getPrivateDataBySlug(slug) {
    return _.find(this.getPrivateData(), { slug: slug });
  }

  findMissingDependencies() {
    const self = this;
    const missing = [];

    this.options.dependencies.forEach(function (dependency) {

      // Dependencies array can have strings (like 'convert') or objects ({name:'convert', message: "to install..."}).
      // To test if it exist, we just need the command name.
      const localDependency = _.isObject(dependency) ? dependency.name : dependency;

      if (!self._checkSystemDependency(localDependency)) {
        const missingMessage = _.isObject(dependency) && dependency.message ? dependency.message : `${dependency} required. You may be able to install with "brew install ${dependency}"`;
        missing.push(missingMessage);
      }
    });

    return missing;
  }

  _checkSystemDependency(app) {
    let appFound = true;

    try {
      execSync('type ' + app, { stdio: 'pipe' });
    } catch (e) {
      appFound = false;
    }

    return appFound;
  }

  _writePrivateData() {
    if (this.options.privateDataPath) {
      this.log(`Writing private data: ${this.options.privateDataPath}`);
      fs.writeFileSync(this.options.privateDataPath, JSON.stringify(this.privateData, null, '\t'));
    }
  }

  _writePublicData() {
    if (this.options.publicDataPath) {
      this.log(`Writing public data: ${this.options.publicDataPath}`);
      fs.writeFileSync(this.options.publicDataPath, JSON.stringify(this.getMetadata(), null, '\t'));
    }
  }

  addTask(cmd, slug, outputFilePath, onComplete, onTimeout) {
    // TODO
    // Throw error if no cmd, slug or outputFilePath

    const privateData = this.privateData;
    const mediaPublicData = this.getMetadataBySlug(slug);
    const mediaPrivateData = this.getPrivateDataBySlug(slug);

    // because a use the cmd as the unique key in our log of previously run
    // commands, and because command can me a string run on the command line or 
    // a js callback, we need a unique string representation for a js callback
    // to use in the log.
    const cmdLog = typeof cmd === 'string' ? cmd : cmd.name + (crypto.createHash('sha256').update(cmd.toString()).digest('hex'));

    // If we don't have a a record of running this task,
    // we'll add it to the queue.
    let runTask = !!(!privateData || !privateData[slug] || !privateData[slug][cmdLog] || privateData[slug][cmdLog] !== mediaPrivateData.srcFileHash);

    // even if we have a record, we'll run again 
    // if the output file doesn't exists
    if (!runTask && !fs.existsSync(outputFilePath)) {
      runTask = true;
    }

    // even if all other checks say we don't
    // need to run the task, run if client
    // requests it.
    if (!runTask && this.options.forceTask) {
      runTask = true;
    }

    if (runTask) {

      // log that this command has been run with this source file
      if (!privateData[slug]) privateData[slug] = {};
      privateData[slug][cmdLog] = mediaPrivateData.srcFileHash;


      this.neededTasks.push({
        cmd: cmd,
        slug: slug,
        media: mediaPublicData,
        onComplete: onComplete,
        onTimeout: onTimeout
      });
    }

    this.allTasks.push(cmd);
  }

  /**
   * 
   * @param  {Object} task {cmd:string/function, slug: string, onComplete: function, onTimeout:function}
   * @return {[type]}      [description]
   */
  _runTask(task) {
    const self = this;

    const cmd = task.cmd;
    const slug = task.slug;
    const onComplete = task.onComplete || function () { };
    const onTimeout = task.onTimeout || function () { };

    const cmdName = typeof cmd === 'string' ? cmd : cmd.name;

    // this._logger.verbose(`Starting: ${cmdName}`);
    this.log(`Starting: ${cmdName}`);

    // uniform callback for js and command
    // line tasks
    function localComplete() {
      self.log(`Done: ${cmdName}`);
      self.emit(`${EventNS}:taskdone`, {
        cmd: cmdName,
        media: self.getMetadataBySlug(slug)
      });
    }

    self.taskQueue.defer(function (callback) {

      // unix command
      if (typeof cmd === 'string') {
        const task = exec(cmd, { timeout: 1000 * 60 * 10 }); // 10 min timeout
        let stdout = '';

        // streaming updates
        task.stdout.on('data', function (data) {
          stdout = stdout + data;
          self._logger.verbose(data);
        });

        task.stderr.on('data', function (data) {
          self._logger.error('exec error: ' + data);
          // todo -- kill child process?
          callback();
        });

        task.on('exit', function (code) {
          if (stdout) self._logger.verbose(stdout);

          if (code === null) {
            onTimeout();
          } else {
            onComplete(stdout);
            localComplete();
          }

          callback();
        });

        // JS callback
      } else {
        cmd(function () {
          onComplete(); // client callback
          localComplete(); // local callback
          callback(); // queue callback
        });
      }
    });
  }

  /**
   * Run all the collected task. 
   * Events notify clients of status.
   */
  runTasks() {
    const self = this;
    let tasksRun = 0; // number of task successfully run, not just requested or needed.

    function getTasksMetaData() {
      return {
        numberOfTasksRequested: self.allTasks.length,
        numberOfTasksNeeded: self.neededTasks.length,
        numberOfTasksRun: tasksRun,
        neededTasks: self.neededTasks,
        tasksRequested: self.allTasks,
        media: self.getMetadata()
      };
    }

    // 
    // Listen for task-related events
    // 

    self.on(`${EventNS}:taskdone`, (data) => {
      tasksRun = tasksRun + 1;
    });

    // tasks done. allow client to act on 
    // metaData (during defer), if needed, 
    // before our final write to disk.
    self.on(`${EventNS}:alltasksdone`, (data) => {
      _.defer(function () {
        self._writePublicData();
        self._writePrivateData();
        self.emit(`${EventNS}:done`, getTasksMetaData());
      });
    });


    // self.emit(`${EventNS}:`, getTasksMetaData());
    self.emit(`${EventNS}:alltasksready`, getTasksMetaData());

    // Prep needed jobs.
    if (self.neededTasks.length > 0) {

      // Filter out jobs that don't need to run b/c output for
      // given input already exists
      self.neededTasks.forEach((task, index) => {
        self._runTask(task);
        if ((index + 1) === self.neededTasks.length) self.emit(`${EventNS}:alltasksrunning`, getTasksMetaData());
      });

      // start the jobs
      self.taskQueue.await((err, files) => {
        if (err) return console.log(err);
        self.emit(`${EventNS}:alltasksdone`, getTasksMetaData());
      });

    } else {
      self.emit(`${EventNS}:alltasksrunning`, getTasksMetaData());
      self.emit(`${EventNS}:alltasksdone`, getTasksMetaData());
    }
  }
}

module.exports = MediaManager;