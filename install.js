'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const get = require('simple-get');
const pump = require('pump');
const tfs = require('tar-fs');
const zlib = require('zlib');
const pkg = require('./package.json');
const supportedTargets = require('./package.json').supportedTargets;

function onerror(err) {
  throw err;
}

/**
 * Download and Install prebuild
 * @param runtime
 * @param abi
 * @param platform
 * @param arch
 * @param cb Callback
 */
function install(runtime, abi, platform, arch, cb) {
  const essential = runtime + '-v' + abi + '-' + platform + '-' + arch;
  const pkgVersion = pkg.version;
  const currentPlatform = pkg.name + '-v' + pkgVersion + '-' + essential;

  console.log('Downloading prebuild for platform:', currentPlatform);
  let tempFile = path.join(os.tmpdir(), 'prebuild.tar.gz');
  const getReleaseUrl = 'https://api.github.com/repos/rpa-helpers/iohook-lib/releases/tags/v' + pkgVersion;
  axios.get(getReleaseUrl).then(function(res1) {
    const assets = res1.data.assets;
    let prebuildAssetUrl;
    for(let i = 0; i < assets.length; i += 1) {
      const asset = assets[i];
      if (asset.name === (currentPlatform + '.tar.gz')) {
        prebuildAssetUrl = asset.url;
        break;
      }
    }
    axios({
      url: prebuildAssetUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        Accept: 'application/octet-stream'
      }
    }).then(function(res) {
        const writer = fs.createWriteStream(tempFile);
        res.data.pipe(writer);
        writer.on('finish', function() {
          let options = {
            readable: true,
            writable: true,
            hardlinkAsFilesFallback: true
          };
          let binaryName;
          let updateName = function(entry) {
            if (/\.node$/i.test(entry.name)) binaryName = entry.name
          };
          let targetFile = path.join(__dirname, 'builds', essential);
          let extract = tfs.extract(targetFile, options)
            .on('entry', updateName);
          pump(fs.createReadStream(tempFile), zlib.createGunzip(), extract, function(err) {
            if (err) {
              return onerror(err);
            }
            cb()
          });
        })
        writer.on('error', onerror)
     }).catch(onerror);
  }).catch(onerror);
}

/**
 * Return options for iohook from package.json
 * @return {Object}
 */
function optionsFromPackage(attempts) {
  attempts = attempts || 2;
  if (attempts > 5) {
    console.log('Can\'t resolve main package.json file');
    return {
      targets: [],
      platforms: [process.platform],
      arches: [process.arch]
    }
  }
  let mainPath = Array(attempts).join("../");
  try {
    const content = fs.readFileSync(path.join(__dirname, mainPath, 'package.json'), 'utf-8');
    const packageJson = JSON.parse(content);
    const opts = packageJson.iohook || {};
    if (!opts.targets) {
      opts.targets = []
    }
    if (!opts.platforms) opts.platforms = [process.platform];
    if (!opts.arches) opts.arches = [process.arch];
    return opts
  } catch (e) {
    return optionsFromPackage(attempts + 1);
  }
}

const options = optionsFromPackage();
if (process.env.npm_config_targets) {
  options.targets = options.targets.concat(process.env.npm_config_targets.split(','));
}
options.targets = options.targets.map(targetStr => targetStr.split('-'));
if (process.env.npm_config_targets === 'all') {
  options.targets = supportedTargets.map(arr => [arr[0], arr[2]]);
  options.platforms = ['win32', 'darwin', 'linux'];
  options.arches = ['x64', 'ia32']
}
if (process.env.npm_config_platforms) {
  options.platforms = options.platforms.concat(process.env.npm_config_platforms.split(','));
}
if (process.env.npm_config_arches) {
  options.arches = options.arches.concat(process.env.npm_config_arches.split(','));
}

// Choice prebuilds for install
if (options.targets.length > 0) {
  let chain = Promise.resolve();
  options.targets.forEach(function(parts) {
    let runtime = parts[0];
    let abi = parts[1];
    options.platforms.forEach(function(platform) {
      options.arches.forEach(function(arch) {
        if ((platform === 'darwin' || platform === 'linux') && arch === 'ia32' || os.platform() !== platform) {
          return;
        }
        chain = chain.then(function() {
          return new Promise(function(resolve) {
            console.log(runtime, abi, platform, arch);
            install(runtime, abi, platform, arch, resolve)
          })
        })
      })
    })
  })
} else {
  const runtime = process.versions['electron'] ? 'electron' : 'node';
  const abi = process.versions.modules;
  const platform = process.platform;
  const arch = process.arch;
  install(runtime, abi, platform, arch, function() {
  })
}
