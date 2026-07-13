'use strict';

/**
 * Graph webhook subscription registry: subscriptionId → userId.
 *
 * Lives in its own module so both server.js (registration/renewal) and
 * routes.js (notification receiver) share ONE map without routes.js having
 * to require('./server') — which created a circular dependency and made the
 * receiver untestable (importing server starts timers and binds the port).
 *
 * In-memory by design: subscriptions are re-registered on boot.
 */
const webhookSubscriptions = new Map();

// The Socket.IO server is registered here by server.js at boot so the webhook
// receiver (routes.js) can emit real-time updates WITHOUT require('./server')
// — which would circularly boot the server (timers, port bind) inside tests.
let _io = null;
function setIo(io) { _io = io; }
function getIo() { return _io; }

module.exports = { webhookSubscriptions, setIo, getIo };
