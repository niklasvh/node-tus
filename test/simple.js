var express     = require("express"),
    upload      = require("../lib/tus"),
    req         = require("superagent"),
    assert      = require("assert"),
    fs          = require("fs"),
    Promise     = require("bluebird"),
    stat        = Promise.promisify(fs.stat),
    port        = 3001,
    host        = "http://localhost:" + port,
    path        = "/files",
    url         = host + path;

var fileProgress = {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
        entityLength: 7,
        content: "",
        offset: 0
    },
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: {
        entityLength: 10,
        content: "abcdefg",
        offset: 7
    },
    cccccccccccccccccccccccccccccccc: {
        entityLength: 5,
        content: "",
        offset: 0
    },
    dddddddddddddddddddddddddddddddd: {
        entityLength: 100,
        content: "",
        offset: 0
    },
    eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee: {
        entityLength: 10,
        content: "qwerty",
        offset: 6
    }
};

var results = [];
var fileMatcher = new RegExp("^" + host + "/files/[0-9a-z]+$");
var uploadDirectory = __dirname + "/files";

function file(filename) {
    return __dirname + "/" + filename;
}

function content(filename) {
    return fs.readFileSync(uploadDirectory + "/" + filename + ".bin").toString();
}

function info(filename) {
    return JSON.parse(fs.readFileSync(uploadDirectory + "/" + filename + ".info").toString());
}

function invalidResponse(done, message) {
    return function(res) {
        assert.equal(res.status, 400);
        assert.equal(res.text, message);
        done();
    };
}


function invalidMethod(done, endpoint, actual, allowed) {
    return function(res) {
        assert.equal(res.status, 405);
        assert.equal(res.get('allow'), allowed)
        assert.equal(res.text, actual + " used against " + endpoint + ". Only " + allowed + " is allowed.");
        done();
    };
}

before(function() {
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory)
    }
    Object.keys(fileProgress).forEach(function(filename) {
        var file = fileProgress[filename];
        fs.writeFileSync(uploadDirectory + "/" + filename + ".bin", file.content);
        fs.writeFileSync(uploadDirectory + "/" + filename + ".info", JSON.stringify({entityLength: file.entityLength, offset: file.offset, meta: {}}));
    });

    var app = express();

    app.use("/files", upload.createServer({
        directory: uploadDirectory,
        maxFileSize: 1024,
        complete: function(info) {
            results.push(info);
        }
    }));

    app.listen(port);
});

after(function() {
    fs.readdirSync(uploadDirectory).forEach(function(filename) {
        fs.unlinkSync(uploadDirectory + "/" + filename);
    });
});

describe("Create server", function() {
    it("without upload directory", function() {
        assert.throws(function() {
            upload.createServer();
        }, /Invalid upload directory/);
    });

    it("with missing upload directory", function() {
        assert.throws(function() {
            upload.createServer({directory: __dirname + "/invalid"});
        }, /Upload directory does not exist/);
    });

    it("with invalid upload directory", function() {
        assert.throws(function() {
            upload.createServer({directory: __dirname + "/simple.js"});
        }, /Specified upload directory is not a directory/);
    });

    it("with invalid maxFileSize", function() {
        assert.throws(function() {
            upload.createServer({directory: __dirname + "/files", maxFileSize: "invalid"});
        }, /maxFileSize option must be a number/);
    });
});


describe("File creation", function() {
    it("with valid headers", function(done) {
        req.post(url)
            .set("Entity-Length", 1024)
            .end(function(res) {
                assert.equal(res.status, 201);
                assert.ok(fileMatcher.test(res.headers.location));
                done();
            });
    });

    it("with filesize exceeding limit", function(done) {
        req.post(url)
            .set("Entity-Length", 2048)
            .end(invalidResponse(done, "File exceeds maximum allowed file size of 1024 bytes"));
    });

    it("with invalid method", function(done) {
        req.put(url)
            .set("Entity-Length", 6)
            .end(invalidMethod(done, "file creation url", "PUT", "POST"));
    });

    it("without Entity-Length", function(done) {
        req.post(url)
            .end(invalidResponse(done, "Entity-Length header must not be empty"));
    });

    it("with invalid Entity-Length", function(done) {
        req.post(url)
            .set("Entity-Length", "non-integer")
            .end(invalidResponse(done, "Invalid Entity-Length header"));
    });

    it("with invalid Entity-Length", function(done) {
        req.post(url)
            .set("Entity-Length", -1)
            .end(invalidResponse(done, "Entity-Length header must be > 0"));
    });
});

describe("File upload", function() {
    describe("using valid file", function() {
        it("get file offset", function (done) {
            req.head(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(res.headers.offset, 0);
                    done();
                });
        });

        it("get file offset when resuming", function (done) {
            req.head(url + "/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(res.headers.offset, 7);
                    done();
                });
        });

        it("with invalid method", function(done) {
            req.put(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .end(invalidMethod(done, "file upload url", "PUT", "HEAD,PATCH"));
        });

        it("with valid file", function (done) {
            var file = "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 0)
                .send("content")
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(content(file), "content");
                    done();
                });
        });

        it("with offset", function (done) {
            var file = "/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 3)
                .send("content")
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(content(file), "abccontent");
                    done();
                });
        });

        it("does not update offset to lower than currently", function (done) {
            var file = "/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 1)
                .send("1234")
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(content(file), "q1234y");
                    req.head(url + file)
                        .end(function (res) {
                            assert.equal(res.status, 200);
                            assert.equal(res.headers.offset, 6);
                            done();
                        });
                });
        });

        it("with exceeding content", function (done) {
            var file = "/cccccccccccccccccccccccccccccccc";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 0)
                .send('digicuicca')
                .set('content-length', 5)
                .end(function (err, res) {
                    setTimeout(function() {
                        assert.equal(res, undefined);
                        assert.equal(content(file), "digic");
                        done();
                    }, 100);
                });
        });

        it("with exceeding offset", function (done) {
            var file = "/dddddddddddddddddddddddddddddddd";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 5)
                .send('digicuicca')
                .end(invalidResponse(done, "Offset: 5 exceeds current offset: 0"));
        });

        it("with too large content-size", function (done) {
            var file = "/cccccccccccccccccccccccccccccccc";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 0)
                .send('digicuicca')
                .end(invalidResponse(done, "Content-Length exceeds file Entity-Length"));
        });

        it("with too large offset + content-size", function (done) {
            var file = "/cccccccccccccccccccccccccccccccc";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 2)
                .send('digi')
                .end(invalidResponse(done, "Offset + Content-Length exceeds file Entity-Length"));
        });

        it("with insufficient content", function (done) {
            var file = "/dddddddddddddddddddddddddddddddd";
            req.patch(url + file)
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', 0)
                .send('digicuicca')
                .timeout(200)
                .set('content-length', 50)
                .end(function (err, res) {
                    assert.equal(res, undefined);
                    assert.equal(content(file), "digicuicca");
                    setTimeout(function() {
                        req.head(url + file)
                            .end(function (res) {
                                assert.equal(res.status, 200);
                                assert.equal(res.headers.offset, 10);
                                done();
                            });
                    }, 100)
                });
        });

        it("with invalid content-type", function (done) {
            req.patch(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .set('offset', 0)
                .end(invalidResponse(done, "Invalid Content-Type"));
        });

        it("with missing offset", function (done) {
            req.patch(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .set('content-type', 'application/offset+octet-stream')
                .end(invalidResponse(done, "Offset header must not be empty"));
        });

        it("with invalid offset", function (done) {
            req.patch(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', -1)
                .end(invalidResponse(done, "Offset header must be > 0"));
        });

        it("with invalid offset", function (done) {
            req.patch(url + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .set('content-type', 'application/offset+octet-stream')
                .set('offset', "invalid")
                .end(invalidResponse(done, "Invalid Offset header"));
        });
    });

    describe("with invalid file", function () {
        it("using valid file id", function(done) {
            req.head(url + "/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
                .end(function (res) {
                    assert.equal(res.status, 404);
                    assert(res.headers.offset == null);
                    done();
                });
        });

        it("using invalid file id", function(done) {
            req.head(url + "/invalid")
                .end(function (res) {
                    assert.equal(res.status, 404);
                    assert(res.headers.offset == null);
                    done();
                });
        });
    });
});

function checkHead(offset) {
    return function(location) {
        return new Promise(function(resolve) {
            req.head(location)
                .end(function (res) {
                    assert.equal(res.status, 200);
                    assert.equal(res.headers.offset, offset);
                    resolve(location);
                });
        });
    };
}

function createEntry(stats) {
    return new Promise(function (resolve) {
        req.post(url)
            .set("Entity-Length", stats.size)
            .set("Entity-Name", "file.png")
            .set("Content-Type", "image/png")
            .end(function (res) {
                var location = res.headers.location;
                assert.equal(res.status, 201);
                assert.ok(fileMatcher.test(location));
                resolve(location);
            });
    });
}

describe("Full upload process", function() {
    it("with a single upload request", function(done) {
        var filename = __dirname + '/content/big_buck_bunny_00001.png';
        stat(filename)
            .then(createEntry)
            .then(checkHead(0))
            .then(function(location) {
                fs.createReadStream(filename).pipe(
                    req.patch(location)
                        .set('content-type', 'application/offset+octet-stream')
                        .set('offset', 0)
                        .set('content-length', 771)
                        .on('response', function(res) {
                            var file = location.substring(location.lastIndexOf("/") + 1);
                            assert.equal(res.status, 200);
                            var meta = info(file).meta;
                            assert.equal(meta.contentType, "image/png");
                            assert.equal(meta.filename, "file.png");
                            assert.equal(content(file), fs.readFileSync(filename).toString());
                            var finishedMeta = results.pop();
                            assert.equal(finishedMeta.name, file);
                            assert.equal(finishedMeta.entityLength, 771);
                            assert.equal(finishedMeta.meta.contentType, "image/png");
                            assert.equal(finishedMeta.meta.filename, "file.png");
                            Promise.resolve(location)
                                .then(checkHead(771))
                                .then(function() {
                                    done();
                                });
                        })
                );
            });
    });

    it("with resuming", function(done) {
        var filename = __dirname + '/content/big_buck_bunny_00001.png';
        stat(filename)
            .then(createEntry)
            .then(checkHead(0))
            .then(function(location) {
                return new Promise(function(resolve) {
                    fs.createReadStream(filename, {start: 0, end: 399}).pipe(
                        req.patch(location)
                            .set('content-type', 'application/offset+octet-stream')
                            .set('offset', 0)
                            .set('content-length', 400)
                    ).on('end', function() {
                        resolve(location);
                    });
                });
            })
            .delay(100)
            .then(checkHead(400))
            .then(function(location) {
                fs.createReadStream(filename, {start: 400}).pipe(
                    req.patch(location)
                        .set('content-type', 'application/offset+octet-stream')
                        .set('offset', 400)
                        .set('content-length', 371)
                        .on('response', function(res) {
                            var file = location.substring(location.lastIndexOf("/") + 1);
                            assert.equal(res.status, 200);
                            assert.equal(content(file), fs.readFileSync(filename).toString());
                            Promise.resolve(location)
                                .then(checkHead(771))
                                .then(function() {
                                    done();
                                });
                        })
                );
            })
    });
});
