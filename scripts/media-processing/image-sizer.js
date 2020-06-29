'use strict';
const _ = require('lodash');
const sizeOf = require('image-size');
const mkdirp = require('mkdirp');
const MediaManager = require('./media-manager');

const MediaNS = 'MediaManager';
const EventNS = 'ImageSizer';

const defaultDependencies = [{
  name: 'convert',
  message: 'Imagemagick required. To install, run:"brew install imagemagick"'
}, 'pngquant'];

const availableFilters = [{
  name: 'strip',
  filter: '-strip'
}, {
  name: 'bw',
  filter: '-colorspace Gray'
}, {
  name: 'blur',
  filter: '-blur 0x5'
}];

const defaultFilers = [];

class ImageSizer extends MediaManager {
  constructor(options) {

    options = _.extend({
      validSourceExts: ['jpg', 'png'],
      limitToSlugs: [],
      forceTask: false, // run task, even if standard test says it doesn't need to run.
      plugins: [],
      availableFilters: [],
      filters: [] // filters used with `convert` command, like 'bw' for black and white
    }, options || {});

    // merge in ImageSizer dependencies with
    // anything passed in.
    options.dependencies = (function () {
      const dependencies = options.dependencies || [];
      return defaultDependencies.concat(dependencies);
    })();

    // merge available filters from user into default available
    options.availableFilters = (function () {
      const filters = options.availableFilters || [];
      return availableFilters.concat(filters);
    })();

    // merge default filters with filters passed in.
    // these are the ones requested to use, not simply
    // available for use.
    options.filters = (function () {
      const filters = options.filters || [];
      return defaultFilers.concat(filters);
    })();

    super(options);
    const self = this;

    // proxy events from media manager into our local namespace
    ['ready', 'alltasksrunning', 'alltasksready', 'taskdone', 'alltasksdone', 'done'].forEach((evName) => {
      self.on(`${MediaNS}:${evName}`, (...args) => {
        self.emit(`${EventNS}:${evName}`, ...args);
      });
    });

    const { widths, standardQuality, retinaQuality } = options;

    // ensure publish directory exists
    mkdirp.sync(options.publishDir);

    // add task for each size, both standard and retina images
    self.getMetadata().forEach((metaData) => {

      // check if slugs need filtered. if so,
      // check that current slug is on white list.
      if (self.options.limitToSlugs.length === 0 || self.options.limitToSlugs.length > 0 && _.indexOf(self.options.limitToSlugs, metaData.slug) > -1) {
        const fileSourcePath = self.getFilePathFromMeta(metaData);

        // add image-specific metadata
        const dimensions = sizeOf(fileSourcePath);
        metaData.ratio = dimensions.height / dimensions.width;
        metaData.sizes = widths;

        // log if retina exist
        metaData.hasRetina = !!retinaQuality;

        widths.forEach((width) => {

          // Generate non-cropped renditions
          const outputFilePath = `${self.options.publishDir}${metaData.slug}-${width}.${metaData.extension}`;
          self.addConvertTask(
            metaData.slug,
            fileSourcePath,
            outputFilePath,
            width,
            self.generateCovertCmd(fileSourcePath, outputFilePath, metaData.extension, width, standardQuality, _.clone(self.options.filters))
          );

          // non-cropped retina
          if (retinaQuality) {
            const retinaOutputFilePath = `${self.options.publishDir}${metaData.slug}-${width}_x2.${metaData.extension}`;
            self.addConvertTask(
              metaData.slug,
              fileSourcePath,
              retinaOutputFilePath,
              width,
              self.generateCovertCmd(fileSourcePath, retinaOutputFilePath, metaData.extension, (width * 2), retinaQuality, _.clone(self.options.filters)),
              true
            );
          }

          // Generate cropped renditions, as needed.
          if (metaData.crops) {
            _.each(metaData.crops, (cropData, cropLabel) => {

              // crop commands are passed to `convert` via
              // and ImageMagick filter.
              // Make copy of filters already planned for this image
              const filters = _.clone(self.options.filters);

              // prep filter string. our crop is within the original image. no resizing applied yet.
              const startX = Math.round(dimensions.width * (cropData.x1 / 100));
              const startY = Math.round(dimensions.height * (cropData.y1 / 100));
              const cropWidth = Math.round(((cropData.x2 - cropData.x1) * dimensions.width) / 100);
              const cropHeight = Math.round(((cropData.y2 - cropData.y1) * dimensions.height) / 100);
              const cropName = _.uniqueId('crop');
              const cropFilter = `-crop ${cropWidth}x${cropHeight}+${startX}+${startY}`;

              // add our filter to the globally available list
              self.options.availableFilters.push({
                name: cropName,
                filter: cropFilter
              });

              // apply the filter to this image
              filters.push(cropName);

              // log back into imagedata.json that this crop has been generated. used in freebird
              cropData.cropped = true;

              // non-retina cropped version
              const outputFilePath = `${self.options.publishDir}${metaData.slug}-${cropLabel}-${width}.${metaData.extension}`;
              self.addConvertTask(
                metaData.slug,
                fileSourcePath,
                outputFilePath,
                width,
                self.generateCovertCmd(fileSourcePath, outputFilePath, metaData.extension, width, standardQuality, filters)
              );

              // retina cropped version
              if (retinaQuality) {
                const retinaOutputFilePath = `${self.options.publishDir}${metaData.slug}-${cropLabel}-${width}_x2.${metaData.extension}`;
                self.addConvertTask(
                  metaData.slug,
                  fileSourcePath,
                  retinaOutputFilePath,
                  width,
                  self.generateCovertCmd(fileSourcePath, retinaOutputFilePath, metaData.extension, (width * 2), retinaQuality, filters),
                  true
                );
              }
            });
          }
        });
      }

    }); // self.getMetadata()

    this.on(`${EventNS}:ready`, (data) => {

      // attach any plugins, as needed
      this.options.plugins.forEach((plugin) => {
        if (!this.verifyPlugin(plugin)) {
          console.log('Invalid plugin');
        } else {
          const pluginTask = plugin.task.bind(this);
          if (plugin.hook === 'ready') {
            pluginTask(data);
          } else {
            this.on(`${EventNS}:${plugin.hook}`, pluginTask);
          }
        }
      });

      // defer so instances can act on media-manager
      // 'ready' before 'alltasksready'
      _.defer(() => {
        self.runTasks();
      });
    });
  }

  verifyPlugin(plugin) {
    return _.isObject(plugin) && plugin.hook && typeof plugin.hook === 'string' && plugin.task && _.isFunction(plugin.task);
  }


  addConvertTask(slug, inputFilePath, outputFilePath, width, convertCmd, isRetina) {
    isRetina = isRetina || false;
    let self = this;

    self.addTask(convertCmd, slug, outputFilePath, function () {
      self.emit(`${EventNS}:crop`, {
        slug: slug,
        width: width,
        isRetina: isRetina,
        inputFilePath: inputFilePath,
        outputFilePath: outputFilePath
      });
    });
  }

  /**
   * Takes metadata about source and output images and converts it into
   * an ImageMagick 'convert' command used to generated the output
   * file with the correct settings.
   *
   * @param {String} inputPath
   * @param {String} outputPath
   * @param {String} fileType
   * @param {Number} width
   * @param {Number} quality
   * @param {Array} filters
   */
  generateCovertCmd(inputPath, outputPath, fileType, width, quality, filters) {
    let self = this;
    let convertCmd;

    // translate filter options into imagemagick compatible string
    const filtersStr = (function () {
      const neededFilters = [];
      filters.forEach(function (filter) {
        let filterCmd = _.find(self.options.availableFilters, {
          name: filter
        });
        if (filterCmd) {
          neededFilters.push(filterCmd.filter);
        } else {
          self.log(`Unknown filter: ${filter}`);
        }
      });

      return neededFilters.join(' ');
    })();


    if (fileType === 'png') {
      convertCmd = `convert "${inputPath}" -quality ${quality} ${filtersStr} -thumbnail ${width}x  png:- | pngquant --skip-if-larger - > "${outputPath}"`;
    } else {
      convertCmd = `convert "${inputPath}" -quality ${quality} ${filtersStr} -thumbnail ${width}x "${outputPath}"`;
    }

    return convertCmd;
  }
}

module.exports = ImageSizer;