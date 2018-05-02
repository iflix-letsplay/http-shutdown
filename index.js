'use strict';
var http = require('http');
var https = require('https');

/**
 * Expose `addShutdown`.
 */
exports = module.exports = addShutdown;

/**
 * Adds shutdown functionaility to the `http.Server` object
 * @param {http.Server} server The server to add shutdown functionaility to
 */
function addShutdown(server, logger) {
  logger = logger || console
  var connections = {};
  var isShuttingDown = false;
  var connectionCounter = 0;

  function destroy(socket, force) {
    if (force || (socket._isIdle && isShuttingDown)) {
      socket.destroySoon();
      delete connections[socket._connectionId];
      logger.info(`Idle socket destroyed. remained=${Object.keys(connections).length}`)
    } else if (!socket._isIdle && isShuttingDown) {
      logger.info('Server is shutting down but socket is not idle!')
    }
  };

  function destroyAllSockets(force, callback, attempt) {
    attempt = attempt || 1
    let connectionKeys = Object.keys(connections)

    let busySockets = connectionKeys.filter(key => connections[key]._isIdle === false).length;
    logger.info(`Connection stats when shutting down: total:${connectionKeys.length}, busy:${busySockets}`);

    connectionKeys.forEach(function(key) {
      destroy(connections[key], force);
    });

    let remainingSockets = Object.keys(connections).length
    if (remainingSockets) {
      if (attempt > 75) {
        logger.info(`Attempted 75 times for 15second to end sockets but still ${remainingSockets} sockets are open!`);
        return callback();
      }

      return setTimeout(() => {
        return destroyAllSockets(force, callback, attempt + 1);
      }, 200)
    }

    logger.info(`All connection are destroyed either safely or by force=${force}! remainingSockets=${remainingSockets}`)
    return callback();
  }

  function onConnection(socket) {
    var id = connectionCounter++;
    socket._isIdle = true;
    socket._connectionId = id;
    connections[id] = socket;

    socket.on('close', function() {
      delete connections[id];
    });
  };

  function onRequest(req, res) {
    let socket = req.socket
    socket._isIdle = false;

    res.on('finish', function() {
      socket._isIdle = true;
      destroy(socket);
    });
  };

  server.on('connection', onConnection);
  server.on('secureConnection', onConnection);
  server.on('request', onRequest);

  function shutdown(force, cb) {
    isShuttingDown = true;
    cb = cb || function(){}

    function closeServer() {
      logger.info('Closing server to prevent receving new connections');
      return new Promise((resolve, reject) => {
        server.close(err => {
          logger.info('Server is closed.');
          return err ? reject(err) : resolve();
        });
      });
    }

    function closeConnections() {
      logger.info('Closing existing connections');
      return new Promise((resolve, reject) => {
        destroyAllSockets(force, () => {
          logger.info(`Number of sockets right before exit: ${Object.keys(connections).length}`);
          return resolve();
        });
      });
    }

    return Promise.all([closeServer(), closeConnections()]).then(() => cb()).catch(cb);
  };

  server.shutdown = function(cb) {
    shutdown(false, cb);
  };

  server.forceShutdown = function(cb) {
    shutdown(true, cb);
  };

  return server;
};

/**
 * Extends the {http.Server} object with shutdown functionaility.
 * @return {http.Server} The decorated server object
 */
exports.extend = function() {
  http.Server.prototype.withShutdown = function() {
    return addShutdown(this);
  };

  https.Server.prototype.withShutdown = function() {
    return addShutdown(this);
  };
};
