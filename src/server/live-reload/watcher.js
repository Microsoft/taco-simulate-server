// Copyright (c) Microsoft Corporation. All rights reserved.

var fs = require('fs'),
    path = require('path'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    log = require('../utils/log');

var EVENT_IGNORE_DURATION = 150;
var WWW_ROOT = 'www';
var MERGES_ROOT = 'merges';
var UNKNOWN_FILE_ID = '__sim-unknown__';

/**
 * @param {string} projectRoot
 * @param {string} platform
 * @constructor
 */
function Watcher(projectRoot, platform) {
    this._projectRoot = projectRoot;
    this._ignoreEvents = {};
    this._mergesOverridePath = path.join(this._projectRoot, MERGES_ROOT, platform);
    this._mergesOverrideExists = fs.existsSync(this._mergesOverridePath);
}

util.inherits(Watcher, EventEmitter);

Watcher.prototype.startWatching = function () {
    var watchPath = path.join(this._projectRoot, WWW_ROOT);
    // TODO: Return Chokidar when it would be compatible with VS Code version >= 1.31 
    // this.wwwWatcher = chokidar.watch(watchPath, {cwd: watchPath}).on('all', handleWwwWatcherEvent.bind(this));
    this.wwwWatcher = fs.watch(watchPath, { recursive: true }, handleWwwWatcherEvent.bind(this));

    if (this._mergesOverrideExists) {
        this.mergesWatcher = fs.watch(this._mergesOverridePath, { recursive: true }, handleMergesWatcherEvent.bind(this));
    }
};

Watcher.prototype.stopWatching = function () {
    if (this.wwwWatcher) {
        this.wwwWatcher.close();
        this.wwwWatcher = null;
    }

    if (this.mergesWatcher) {
        this.mergesWatcher.close();
        this.mergesWatcher = null;
    }
};

function handleWwwWatcherEvent(event, fileRelativePath) {
    handleWatcherEvent.bind(this)(WWW_ROOT, fileRelativePath);
}

function handleMergesWatcherEvent(event, fileRelativePath) {
    handleWatcherEvent.bind(this)(MERGES_ROOT, fileRelativePath);
}

function handleWatcherEvent(root, fileRelativePath) {
    // Visual studio generates temporary files that we want to ignore
    if (ignoreTemporaryFile(fileRelativePath)) {
        return;
    }

    // fs.watch() will often send events more than once for the same modification, especially on Windows.
    // A workaround is to block events generated by the same file for a short duration.
    var ignoreId = fileRelativePath || UNKNOWN_FILE_ID;

    if (this._ignoreEvents[ignoreId]) {
        return;
    }

    if (!fileRelativePath) {
        // fs.watch() doesn't always set the fileRelativePath argument properly. If that happens, let the user know.
        log.warning('Could not reload the modified file because fs.watch() didn\'t specify which file was changed');
        return;
    }

    // Make sure the event is for a file, not a directory
    var isWww = root === WWW_ROOT;
    var srcPathPrefix = isWww ? path.join(this._projectRoot, WWW_ROOT) : this._mergesOverridePath;
    var filePathFromProjectRoot = path.join(srcPathPrefix, fileRelativePath);

    if (fs.existsSync(filePathFromProjectRoot) && fs.statSync(filePathFromProjectRoot).isDirectory()) {
        return;
    }

    // If the modified file is under www/, but has a merges/[platform]/ override,
    // we don't do anything (because the running app is not using the file that was just modified).
    if (isWww && fileHasMergesOverride.bind(this)(fileRelativePath)) {
        return;
    }

    this._ignoreEvents[ignoreId] = true;
    setTimeout(function () {
        this._ignoreEvents[ignoreId] = false;
        this.emit('file-changed', fileRelativePath, root);
    }.bind(this), EVENT_IGNORE_DURATION);
}

function fileHasMergesOverride(fileRelativePath) {
    return this._mergesOverrideExists && fs.existsSync(path.join(this._mergesOverridePath, fileRelativePath));
}

function ignoreTemporaryFile(fileRelativePath) {
    if (!fileRelativePath) {
        return false;
    }

    var fileName = path.basename(fileRelativePath);
    var ext = path.extname(fileRelativePath);
    return ext.toLowerCase() === '.tmp' && fileName.indexOf('~') > -1 || ext.indexOf('~') > -1;
}

exports.Watcher = Watcher;
