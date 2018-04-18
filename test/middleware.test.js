var cp = require('child_process');
var path = require('path');
var http = require('http');
var assert = require('assert');

var app;
describe('middleware', function() {

  before(function(done) {
    var appFile = path.join(__dirname, 'apps', 'test.js');
    app = cp.fork(appFile);
    app.on('message', function() {
      done();
    });
  });

  after(function() {
    process.kill(app.pid, 'SIGTERM');
  });

  it('should load middleware', function(done) {
    var options = {
      hostname: 'localhost',
      port: 8080,
      path: '/test/integrity:isOrmLoaded'
    };
    var req = http.get(options, function(res) {
      var rawData = '';
      res.on('data', function(chunk) { rawData += chunk; });
      res.on('end', function() {
        var parsedData = JSON.parse(rawData);
        assert(parsedData.loaded, 'orm is not loaded');
        done();
      });
    });
    req.end();
  });
});
