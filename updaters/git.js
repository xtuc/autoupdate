
var config = require('../config');
var GIT_REPO_LOCAL_FOLDER = config.GIT_REPO_LOCAL_FOLDER;
var git = require('gift');
var async = require('async');
var _ = require('lodash');
var path = require('path');
var glob = require('glob');
var cdnjs = require('./cdnjs');
var fs = require('fs-extra');
var stable = require('semver-stable');
var compareVersions = require('compare-versions');
var colors = require('colors');
var isThere = require('is-there');

function hasVersionPrefix(version) {
  if (version[0] !== 'v' && version[0] !== 'V' && version[0] !== 'r') {
    return false;
  } else if (version.length > 1 && !isNaN(version[1])) {
    return true;
  }

  return false;
}

var update = function (library, callback) {
  var target = library.autoupdate.target;
  var localTarget = path.normalize(path.join(
    __dirname, '../', GIT_REPO_LOCAL_FOLDER, library.name
  ));
  async.series([
    function (next) {
      if (!isThere(localTarget)) {
        console.log('Clone', target, 'to', localTarget);
        git.clone(target, localTarget, function (err, repo) {
          if (err) {
            throw err;
          } else {
            next();
          }
        });
      } else {
        next();
      }
    },

    function (next) {
      var repo = git(localTarget);
      console.log('Use', localTarget, 'as source of', library.name);
      repo.remote_fetch('origin', function (err) {
        if (err) {
          console.log(library.name, 'git repo fetch failed');
          console.log(err);
          return next();
        }

        repo.tags(function (err, tags) {
          if (err) {
            console.log(library.name, 'git tag handle failed');
            console.log(err);
            return next();
          }

          var versions = _.map(tags, function (tag) {
            return tag.name;
          });

          var needed = _.filter(versions, function (version) {
            if (hasVersionPrefix(version)) {
              version = version.substr(1);
            }

            return (!cdnjs.checkVersion(library, version) && /\d+/.test(version));
          });

          if (needed.length > 0) {
            console.log(library.name, 'needs versions:', needed.join(', ').blue);
          }

          async.eachSeries(needed, function (tag, callback) {
            repo.checkout(tag, { force: true }, function () {
              if (hasVersionPrefix(tag)) {
                tag = tag.substr(1);
              }

              var basePath = library.autoupdate.basePath || '';
              var libContentsPath = path.normalize(path.join(localTarget, basePath));
              var allFiles = [];

              _.each(library.autoupdate.fileMap, function (mapGroup) {
                var cBasePath = mapGroup.basePath || '';
                var files = [];
                libContentsPath = path.normalize(path.join(localTarget, cBasePath)),
                _.each(mapGroup.files, function (cRule) {
                    var newFiles = glob.sync(path.normalize(
                      path.join(libContentsPath, cRule)),
                      { nodir: true, realpath: true }
                    );
                    files = files.concat(newFiles);
                    if (newFiles.length === 0) {
                      console.log('Not found'.red, cRule.cyan, tag);
                      fs.mkdirsSync(path.normalize(path.join(
                        __dirname, '../../cdnjs', 'ajax', 'libs', library.name, tag
                      )));
                    }
                  });

                allFiles = allFiles.concat(files.map(function (c) {
                  return {
                      _: c,
                      basePath: cBasePath
                    };
                }));
              });

              console.log('All files for ' + library.name + ' v' + tag, '-', allFiles.length);
              console.log(allFiles.length, allFiles.length !== 0);
              library.version = library.version || '0.0.0';
              var greaterVer;
              try {
                greaterVer = compareVersions(tag, library.version) > 0;
              } catch (e) {
                greaterVer = false;
              }

              if (
                (allFiles.length !== 0) &&
                (
                  (!library.version) ||
                  (
                    (greaterVer) &&
                    (
                      (stable.is(tag)) ||
                      (!stable.is(tag) && !stable.is(library.version))
                    )
                  )
                )
              ) {
                console.log('Updated package.json to version'.green, tag);
                var libraryPath = path.normalize(path.join(
                  __dirname, '../../cdnjs', 'ajax', 'libs', library.name, 'package.json'
                ));
                  var libraryJSON = {};
                  try {
                      libraryJSON = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
                  } catch (e) {
                      console.log("reading package.json error", e);
                  }
                libraryJSON.version = tag;
                fs.writeFileSync(libraryPath, JSON.stringify(libraryJSON, undefined, 2) + '\n');
              }

              async.each(allFiles, function (file, callback) {
                var fileName = path.relative(path.join(localTarget, file.basePath), file._);
                var fileTarget = path.normalize(path.join(
                  __dirname, '../../cdnjs', 'ajax', 'libs', library.name, tag, fileName
                ));
                fs.ensureFile(fileTarget, function (err) {
                  if (err) {
                    console.log('Some strange error occured here'.red);
                    console.dir(err);
                    callback();
                  } else {
                    fs.copy(file._, fileTarget, function (err) {
                      if (err) {
                        console.dir(err);
                        console.log('Some strange error occured here'.red);
                        callback();
                      } else {
                        fs.chmodSync(fileTarget, '0644');
                        callback();
                      }
                    });
                  }
                });
              }, function () {

                callback();
              });
            });
          }, function () {

            console.log(library.name.green, 'updated from Git'.green);
            callback(null, 1);
          });
        });
      });
    }
  ]);
};

module.exports = {
  update: update
};
