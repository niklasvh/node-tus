# node-tus

[![Build Status](https://travis-ci.org/niklasvh/node-tus.png)](https://travis-ci.org/niklasvh/node-tus)
[![NPM Downloads](https://img.shields.io/npm/dm/tus.svg)](https://www.npmjs.org/package/tus)
[![NPM Version](https://img.shields.io/npm/v/tus.svg)](https://www.npmjs.org/package/tus)

Node.js resumable upload middleware for [express](http://expressjs.com/)/[connect](https://github.com/senchalabs/connect) implementing the [tus resumable upload protocol](http://tus.io/protocols/resumable-upload.html).

## Installation

    $ npm install tus

## Usage

To attach the resumable upload middleware to express or connect, create an upload server by calling `createServer` passing it an `options` object. Available options are:

 - **directory** - String - Path where to upload the files (required)
 - **maxFileSize** - Number - Maximum file size for uploads, in bytes (optional)
 - **complete** - Function - Callback to inform when a file (all chunks) have been uploaded. Passes the file metadata as an argument (optional)
 
Example:

```js
var express = require("express"),
    upload = require("tus");

var app = express();
var port = 3000;

app.use("/files", upload.createServer({
    directory: __dirname + "/uploads",
    maxFileSize: 1024,
    complete: function(fileMetadata) {
        console.log("File uploaded with the following metadata:", fileMetadata);
    }
}));

app.listen(port);
```

## Running Tests

    $ npm test

## License

Licensed under the MIT license.
