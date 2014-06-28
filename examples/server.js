var express = require("express"),
    upload = require("../");

var app = express();
var port = 3000;

app.use("/files", upload.createServer({
    directory: __dirname + "/uploads"
}));

app.listen(port);

console.log("Server running on port", port);
