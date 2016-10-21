var express = require("express");
var app = express();
var http = require("http");
http.createServer(app).listen(process.env.port || 80);
var request = require("request");
var jsdom = require("jsdom");
var fs = require("fs");
var stream = require("stream");
app.use(express.static("static"));

const MAXERRORS = 2;

var cache = {

}

function addToCache(domain, buf) {
  if(cache[domain]) {
    if(buf.toString() == cache[domain].data.toString()) {
      var c = cache[domain];
      c.expires = computeCacheTTL(++c.unchanged);
      return;
    }
  } 
  cache[domain] = {
    data: buf,
    expires: computeCacheTTL(0),
    unchanged: 0
  }
  return;
}

function computeCacheTTL(unchanged) {
  const timeModifers = [ 1, 2, 6, 24, 168 ]
  const time = 3600000;
  return Date.now() + (time * timeModifers[Math.min(unchanged, timeModifers.length - 1)]);
}

function truncate(str) {
  return str.replace(/((http(s)?:)?\/\/)?(.*)/, "$4");
}

function resolve(str) {
  return str.replace(/((http(s)?:)?\/\/)?(.*)/, "http://$4");
}

app.get("/get/:domain", function(req, res) {
  var domain = req.params.domain;
  complex(domain, function(result, nocache) {
    if(result) {
      if(!nocache) {
        addToCache(domain, result);
      }
      res.set("Content-Type", "image/x-icon").send(result);
    } else {
      res.sendStatus(404);
    }
  });
});

function basic(domain, cb) {
  makeRequest({ url: resolve(domain + "/favicon.ico"), encoding: null }, cb);
}

function complex(domain, cb, reattempt) {
  if(reattempt > MAXERRORS) {
    return cb(false);
  }
  if(cache[domain]) {
    if(cache[domain].expires > Date.now()) {
      return cb(cache[domain].data, true);
    }
  }
  basic(domain, function(buf) {
    if(buf) {
      cb(buf);
    } else {
      request(resolve(domain), function(err, data, body) {
        if(err) {
          console.info("Failed attempt");
          return complex(domain, cb, (reattempt || 0) + 1);
        }
        check(domain, body, function(buf) {
          if(buf) {
            cb(buf);
          } else {
            cb("404", true);
          }
        })
      });
    }
  });
}

function makeRequest(req, cb) {
  request(req, function(err, data, body) {
    if(err || (data.headers["content-type"] || "").indexOf("image") == -1) {
      if(data && data.statusCode == "200" && data.headers["content-type"] && data.headers["content-type"].indexOf("text/plain") > -1)
        return cb(body);
      cb(false);
    } else {
      cb(body);
    }
  });
}

function check(domain, body, cb) {
  if(body == null) return cb(false);
  jsdom.env(body, function(err, window) {
    var d = window.document;
    var arr = Array.prototype.slice.apply(d.querySelectorAll("link[rel='shortcut icon']"), [0]);
    arr = arr.concat(Array.prototype.slice.apply(d.querySelectorAll("link[rel='icon']"), [0]));
    if(arr.length == 0) {
      console.log("No favicon specified");
      return cb(false);
    } else {
      makeRequest({ url: resolve(arr[0].href), encoding: null }, cb);
    }
  })
}