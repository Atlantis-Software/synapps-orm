// lib/offshore/collection/loader
//97    // Ensure the named connection exist
//98    if (conn !== 'default' && !hasOwnProperty(connections, conn)) {



var Offshore = require('offshore');
var asynk = require('asynk');
var path = require('path');
var fs = require('fs');
var _  = require('lodash');

function autoLoadConnections(root, cb) {
  var connectionsFile = path.join(root, 'connections.js');

  fs.stat(connectionsFile, function(err, stats) {
    if (err && err.code === 'ENOENT') {
      return cb(new Error('no `connections.js` file, could not auto load connections'));
    }
    if (err) {
      return cb(err);
    }
    if (!stats.isFile()) {
      throw new Error('`connections.js` is not a file, could not auto load connections');
    }
    var connections = null;
    try {
      connections = require(connectionsFile);
    } catch(e) {
      return cb(e);
    }
    if (connections && _.isObject(connections)) {
      return cb(null, connections);
    }
    cb(new Error('could not load connections from file ' + connectionsFile));
  });
}

function loadAdapters(connections, cb) {
  var connectionNames = _.keys(connections);
  var adapters = {};
  if (connectionNames.length === 0) {
    return cb(new Error('no connection defined'));
  }
  var error = null;
  connectionNames.forEach(function(connectionName) {
    var connection = connections[connectionName];
    if (!connection.adapter) {
      return error = new Error('no adapter defined for connection ' + connectionName);
    }
    var adapter = require(connection.adapter);
    if (!adapter) {
      return error = new Error('could not find adapter ' + connection.adapter + ' defined for connection ' + connectionName);
    }
    adapters[connection.adapter] = adapter;
  });
  if (error) {
    return cb(error);
  }
  cb(null, adapters);
}

function checkModel(name, model) {
  if (!model.identity && !model.tablename) {
    return new Error('Model ' + name + ' must include an identity or tableName attribute');
  }
  return;
}

function autoLoadModels(root, cb) {
  var modelsDir = path.join(root, 'models');
  fs.stat(modelsDir, function(err, stats) {
    if (err && err.code === 'ENOENT') {
      return cb(new Error('no `models` dir, could not auto load models'));
    }
    if (err) {
      return cb(err);
    }
    if (!stats.isDirectory()) {
      return cb(new Error('`models` is not a directory, could not auto load models'));
    }
    fs.readdir(modelsDir, function(err, models) {
      if (err) {
        throw new Error('could not open `models` directory, could not auto load models');
      }
      if (models.length === 0) {
        throw new Error('no model defined in dir ' + modelsDir);
      }
      asynk.each(models, function(model, cb) {
        var modelFilepath = path.join(modelsDir, model);
        if (model.endsWith('.json')) {
          fs.readFile(modelFilepath, 'utf8', function(err, filecontent) {
            if (err) {
              return cb(err);
            }
            var modelObj;
            try {
              modelObj = JSON.parse(filecontent);
            } catch(e) {
              return cb(e);
            }
            modelObj.schema = modelObj.schema || true;
            modelObj.migrate = modelObj.migrate || 'safe';
            modelObj.connection = modelObj.connection || 'default';

            var error = checkModel(model, modelObj);
            if (error) {
              return cb(error);
            }
            cb(null, Offshore.Collection.extend(modelObj));
          });
        } else if (model.endsWith('.js')){
          modelObj.schema = modelObj.schema || true;
          modelObj.migrate = modelObj.migrate || 'safe';
          modelObj.connection = modelObj.connection || 'default';
          var modelObj = require(modelFilepath);
          var error = checkModel(model, modelObj);
          if (error) {
            return cb(error);
          }
          cb(null, Offshore.Collection.extend(modelObj));
        } else {
          cb(new Error('model unsupported file type ' + model));
        }
      }).parallelLimited(10).asCallback(cb);
    });

  });
}


module.exports = function(config) {
  var root = path.dirname(module.parent.filename);
  config = config || {};
  // initialize connections configuration
  var connectionsDeffer = asynk.deferred();
  if (!config.connections) {  
    // auto load connections
    autoLoadConnections(root, function(err, connections) {
      if (err) {
        return connectionsDeffer.reject(err);
      }
      config.connections = connections;
      loadAdapters(connections, function(err, adapters) {
        if (err) {
          return connectionsDeffer.reject(err);
        }
        config.adapters = adapters;
        connectionsDeffer.resolve();
      });
    });
  } else {
    loadAdapters(config.connections, function(err, adapters) {
      if (err) {
        return connectionsDeffer.reject(err);
      }
      config.adapters = adapters;
      connectionsDeffer.resolve();
    });
  }

  // initialize collections configuration
  var offshore = new Offshore();
  var collectionsDeffer = asynk.deferred();
  if (!config.collections) {
    // auto load models
    autoLoadModels(root, function(err, models) {
      if (err) {
        return collectionsDeffer.reject(err);
      }
      models.forEach(function(model) {
        offshore.loadCollection(model);
      });
      collectionsDeffer.resolve();
    });
  } else {
    collectionsDeffer.resolve();
  }

  var init = asynk.deferred();
  asynk.when(connectionsDeffer, collectionsDeffer).done(function() {
    offshore.initialize(config, function(err, orm) {
      if (err) {
        throw err;
      }

      var collections = _.keys(orm.collections);
      var CollectionMutator = function(defaultConnection) {
        this._defaultConnection = defaultConnection;
      };
      collections.forEach(function(collectionName) {
        Object.defineProperty(CollectionMutator.prototype, collectionName, {
          get: function() {
            if (!orm.collections[collectionName]) {
              return;
            }
            return orm.collections[collectionName]._loadQuery({defaultConnection: this._defaultConnection});
          }
        });
      });

      init.resolve(orm);
    });
  }).fail(function(err) {
    throw err;
  });

  return function(req, next) {
    init.done(function(orm) {
      req.db = orm.collections;
      next();
    });
  };
};
