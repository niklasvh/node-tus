var fs      = require('fs'),
    url     = require('url'),
    Promise = require("bluebird"),
    crypto  = require('crypto');

var fileUrlMatcher = /^\/([a-z0-9]{32})$/,
    writeFile = Promise.promisify(fs.writeFile),
    readFile = Promise.promisify(fs.readFile),
    exists = function(file) {
        return new Promise(function(resolve, reject) {
            fs.exists(file, function(exists) {
                if (exists) {
                    resolve(exists);
                } else {
                    reject(exists);
                }
            })
        })
    };

function NotFound(msg) {
    this.message = msg;
}

NotFound.prototype = Object.create(Error.prototype);


function BadRequest(msg) {
    this.message = msg;
}

BadRequest.prototype = Object.create(Error.prototype);

function getPositiveIntHeader(req, key) {
    return new Promise(function(resolve) {
        var val = req.get(key);
        if (val == null) {
            throw new BadRequest(key + " header must not be empty");
        }

        var intVal = parseInt(val, 10);

        if (isNaN(intVal)) {
            throw new BadRequest("Invalid " + key + " header");
        } else if (intVal < 0) {
            throw new BadRequest(key + " header must be > 0");
        }

        resolve(intVal);
    });
}

function createEmptyFile(name, directory, entityLength, meta) {
    return Promise.join(
        writeFile(directory + "/" + name + ".bin", new Buffer(0)),
        writeFile(directory + "/" + name + ".info", JSON.stringify({name: name, entityLength: entityLength, offset: 0, meta: meta}), "utf8"),
        function() {
            return name;
        });
}

exports.createServer = function(opts) {
    var options = typeof(opts) === "object" ? opts : {};

    if (typeof(options.directory) !== "string") {
        throw new Error("Invalid upload directory. Make sure to specify the directory option when creating the upload server");
    }

    if (!fs.existsSync(options.directory)) {
        throw new Error("Upload directory does not exist");
    }

    if (!fs.lstatSync(options.directory).isDirectory()) {
        throw new Error("Specified upload directory is not a directory");
    }

    if (options.maxFileSize != null && isNaN(options.maxFileSize)) {
        throw new Error("maxFileSize option must be a number");
    }

    function getInfo(id) {
        return readFile(options.directory + "/" + id + ".info").then(JSON.parse);
    }

    function createFile(req, res) {
        getPositiveIntHeader(req, "Entity-Length").then(function(entityLength) {
            if (options.maxFileSize != null && entityLength > options.maxFileSize) {
                throw new BadRequest("File exceeds maximum allowed file size of " + options.maxFileSize + " bytes");
            }
            return createEmptyFile(crypto.randomBytes(16).toString('hex'), options.directory, entityLength, {contentType: req.get('Content-Type') || null, filename: req.get('Entity-Name') || null});
        }).then(function(name) {
            res.set('Location', url.resolve(req.protocol + '://' + req.get('host') + (options.path ? options.path : req.originalUrl) + "/", name));
            res.send(201);
        }).catch(BadRequest, function(err) {
            res.send(400, err.message);
        }).catch(function() {
            res.send(500);
        });
    }

    function patchFile(id, req, res, next) {
        Promise.all([exists(options.directory + "/" + id + ".info", options.directory + "/" + id + ".bin")])
            .then(function() {
                if (req.get('content-type') !== "application/offset+octet-stream") {
                    throw new BadRequest("Invalid Content-Type");
                }
                return getPositiveIntHeader(req, "Offset");
            }, function() {
                throw new NotFound();
            }).then(function(offset) {
                return getInfo(id).then(function (info) {
                    if (offset > info.offset) {
                        throw new BadRequest("Offset: " + offset + " exceeds current offset: " + info.offset);
                    }

                    return getPositiveIntHeader(req, "Content-Length").then(function(length) {
                        if (length > info.entityLength) {
                            throw new BadRequest("Content-Length exceeds file Entity-Length")
                        }

                        if (offset + length > info.entityLength) {
                            throw new BadRequest("Offset + Content-Length exceeds file Entity-Length")
                        }
                    });
                }).return(offset);
            }).then(function(offset) {
                var stream = fs.createWriteStream(options.directory + "/" + id + ".bin", {
                    flags: 'r+',
                    start: offset
                });
                return [
                    new Promise(function (resolve, reject) {
                        req.pipe(stream);
                        req.on('end', resolve);
                        req.on('close', resolve);
                        req.on('error', reject);
                        stream.on('error', reject);
                    }).finally(function() {
                        stream.end();
                    }),
                    new Promise(function(resolve) {
                        stream.on('finish', resolve);
                    }).then(function() {
                        return getInfo(id).then(function(info) {
                            var byteOffset = offset + stream.bytesWritten;
                            if (info.offset < byteOffset) {
                                info.offset = byteOffset;
                                return writeFile(options.directory + "/" + id + ".info", JSON.stringify(info), "utf8").return(info);
                            }
                            return Promise.resolve(info);
                        });
                    })
                ];
            }).spread(function(promise, info) {
                if (typeof options.complete === "function" && info.offset >= info.entityLength) {
                    req.upload = info;
                    options.complete(req, res, next);
                } else {
                    res.send(200);
                }
            }).catch(BadRequest, function(err) {
                res.send(400, err.message);
            }).catch(NotFound, function() {
                res.send(404);
            }).catch(function() {
                res.send(500);
            });
    }

    function headFile(id, res) {
        readFile(options.directory + "/" + id + ".info")
            .then(JSON.parse)
            .then(function(info) {
                res.set("Offset", info.offset);
                res.send(200);
            }).catch(function() {
                res.send(404);
            });
    }

    return function(req, res, next) {
        if (req.url === "/") {
            if (req.method === "POST") {
                createFile(req, res, next);
                return;
            }

            res.set("Allow", "POST");
            res.send(405, req.method + " used against file creation url. Only POST is allowed.");
            return;
        }

        var matches;
        if ((matches = req.url.match(fileUrlMatcher)) !== null) {
            var id = matches[1];
            if (req.method === "PATCH") {
                patchFile(id, req, res, next);
                return;
            } else if (req.method === "HEAD") {
                headFile(id, res);
                return;
            }

            var allowed = "HEAD,PATCH";
            res.set("Allow", allowed);
            res.send(405, req.method + " used against file upload url. Only " + allowed + " is allowed.");
            return;
        }

        next();
    };
};
