var orm = require('../../index');
var synapps = require('@synapps/core');

var app = synapps();
app.set('apiDir', 'test');
app.set('maxWorker', 1);
app.set('debug', 'all');

app.use(orm({
  connections: {
    mycnx: {
      adapter: 'offshore-memory',
      default: true
    }
  },
  collections: [{
    identity: 'test',
    attributes: {
      id: {
        type: 'integer',
        autoIncrement: true,
        primaryKey: true
      }
    }
  }]
}));

app.route('integrity', {
  isOrmLoaded: [{}, function(req) {
    req.resolve({
      loaded: !!req.db
    });
  }]
});

app.listen(8080, function() {
  process.send('OK');
});
