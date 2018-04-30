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
  var connections = {};
  var isShuttingDown = false;
  var connectionCounter = 0;

  function destroy(socket, force) {
    if (force || (socket._isIdle && isShuttingDown)) {
      socket.destroy();
      delete connections[socket._connectionId];
    } else if (!socket._isIdle && isShuttingDown) {
      logger.info('Server is shutting down but socket is not idle!')
    }
  };

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

    logger.info('Closing server to prevent receving new connections');
    server.close(function(err) {
      if (cb) {
        logger.info('Server is closed. callback will be called on nextTick phase.')
        process.nextTick(function() {
          logger.info(`Number of sockets right before exit: ${Object.keys(connections).length}`);
          cb(err);
        });
      }
    });

    let busySockets = Object.keys(connections).filter(key => connections[key]._isIdle === false).length;
    logger.info(`Number of busy sockets when shutting down: ${busySockets}`);

    Object.keys(connections).forEach(function(key) {
      destroy(connections[key], force);
    });
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
