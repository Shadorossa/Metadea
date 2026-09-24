// Worker side of the plugin runtime: the `metadea` SDK every plugin sees.
// This file is imported as raw text (`?raw`) and composed into the worker's
// Blob by compose-worker-source.ts:
//
//   <this file>(self, <config JSON>);
//   (function (metadea) { <plugin main.js> \n}).call(undefined, self.metadea);
//
// so it must stay one self-contained function expression with no imports.
// Message protocol: protocol.ts. Public API: docs/PLUGINS.md.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- composed, not executed as a module
(function metadeaPluginBootstrap(scope, config) {
  'use strict';

  var post = scope.postMessage.bind(scope);

  // ── Isolation ──────────────────────────────────────────────────────────
  // The worker inherits the page's CSP, whose connect-src allows https:.
  // Every network, storage and worker-spawning global is removed from the
  // scope and its prototype chain so metadea.http.fetch (checked by Rust
  // against the granted hosts) is the only way out, and the app's own
  // IndexedDB/Cache Storage (same origin) stays out of reach.
  var BLOCKED = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport',
    'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches',
    'RTCPeerConnection', 'RTCDataChannel', 'FileSystemHandle', 'StorageManager',
  ];
  for (var target = scope; target; target = Object.getPrototypeOf(target)) {
    for (var i = 0; i < BLOCKED.length; i += 1) {
      var name = BLOCKED[i];
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        try { delete target[name]; } catch { /* non-configurable: shadowed below */ }
      }
    }
  }
  for (var j = 0; j < BLOCKED.length; j += 1) {
    try {
      Object.defineProperty(scope, BLOCKED[j], { value: undefined, writable: false, configurable: false });
    } catch { /* already gone */ }
  }
  try {
    if (scope.navigator && 'storage' in scope.navigator) {
      Object.defineProperty(Object.getPrototypeOf(scope.navigator), 'storage', { get: function () { return undefined; } });
    }
  } catch { /* not present */ }

  // ── Host calls ─────────────────────────────────────────────────────────
  var nextId = 1;
  var pendingHost = new Map();

  function toMessage(error) {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  }

  function hostCall(method, args) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pendingHost.set(id, { resolve: resolve, reject: reject });
      post({ t: 'host', id: id, method: method, args: args });
    });
  }

  function logArgs(values) {
    var out = [];
    for (var k = 0; k < values.length && k < 20; k += 1) {
      var value = values[k];
      var text;
      try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { text = String(value); }
      out.push(String(text).slice(0, 2000));
    }
    return out;
  }

  function log(level) {
    return function () {
      post({ t: 'log', level: level, args: logArgs(Array.prototype.slice.call(arguments)) });
    };
  }

  // ── Registration ───────────────────────────────────────────────────────
  var handlers = null;
  var registered;
  var registeredPromise = new Promise(function (resolve) { registered = resolve; });
  var POINTS = ['sources', 'workActions', 'workPanels', 'events'];

  function register(contributions) {
    if (handlers) throw new Error('metadea.register can only be called once');
    if (!contributions || typeof contributions !== 'object') throw new Error('metadea.register expects an object');
    handlers = {};
    var summary = {};
    for (var p = 0; p < POINTS.length; p += 1) {
      var point = POINTS[p];
      var group = contributions[point] || {};
      handlers[point] = group;
      summary[point] = Object.keys(group);
    }
    post({ t: 'registered', contributions: summary });
    registered();
  }

  function resolveHandler(point, target, method) {
    var group = handlers && handlers[point];
    var entry = group && Object.prototype.hasOwnProperty.call(group, target) ? group[target] : undefined;
    if (point === 'sources') {
      var fn = entry && typeof entry[method] === 'function' ? entry[method].bind(entry) : null;
      return fn;
    }
    return typeof entry === 'function' ? entry : null;
  }

  var settings = config.settings || {};

  var metadea = Object.freeze({
    apiVersion: 1,
    plugin: Object.freeze({ id: config.id, version: config.version }),
    register: register,
    http: Object.freeze({
      fetch: function (url, init) {
        var options = init || {};
        return hostCall('http.fetch', [{
          url: String(url),
          method: options.method,
          headers: options.headers,
          body: options.body,
          bodyBase64: options.bodyBase64,
          responseType: options.responseType,
          timeoutMs: options.timeoutMs,
        }]).then(function (response) {
          response.ok = response.status >= 200 && response.status < 300;
          response.json = function () { return JSON.parse(response.body); };
          return response;
        });
      },
    }),
    storage: Object.freeze({
      get: function (key) {
        var k = String(key);
        return hostCall('storage.get', [k]).then(function (raw) {
          return raw == null ? null : JSON.parse(raw);
        });
      },
      set: function (key, value) {
        var k = String(key);
        var raw = value === undefined || value === null ? null : JSON.stringify(value);
        return hostCall('storage.set', [k, raw]).then(function () { return undefined; });
      },
    }),
    settings: Object.freeze({
      get: function () { return Promise.resolve(JSON.parse(JSON.stringify(settings))); },
    }),
    log: Object.freeze({ info: log('info'), warn: log('warn'), error: log('error') }),
    notify: function (title, body) {
      return hostCall('notify', [String(title || ''), String(body || '')]).then(function () { return undefined; });
    },
  });

  // ── Incoming messages ──────────────────────────────────────────────────
  function reply(id, promise) {
    Promise.resolve()
      .then(function () { return promise(); })
      .then(
        function (value) { post({ t: 'result', id: id, ok: true, value: value === undefined ? null : value }); },
        function (error) { post({ t: 'result', id: id, ok: false, error: toMessage(error) }); }
      )
      .catch(function (error) {
        // The value could not be cloned (functions, DOM-like objects…).
        post({ t: 'result', id: id, ok: false, error: 'unserializable result: ' + toMessage(error) });
      });
  }

  scope.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') {
      post({ t: 'pong', id: msg.id });
      return;
    }
    if (msg.t === 'reply') {
      var pending = pendingHost.get(msg.id);
      if (!pending) return;
      pendingHost.delete(msg.id);
      if (msg.ok) pending.resolve(msg.value); else pending.reject(new Error(msg.error));
      return;
    }
    if (msg.t === 'call') {
      reply(msg.id, function () {
        return registeredPromise.then(function () {
          var fn = resolveHandler(msg.point, msg.target, msg.method);
          if (!fn) throw new Error('no handler registered for ' + msg.point + '.' + msg.target + (msg.method ? '.' + msg.method : ''));
          return fn.apply(undefined, Array.isArray(msg.args) ? msg.args : []);
        });
      });
      return;
    }
    if (msg.t === 'event') {
      registeredPromise.then(function () {
        var fn = resolveHandler('events', msg.name);
        if (!fn) return;
        Promise.resolve()
          .then(function () { return fn(msg.payload); })
          .catch(function (error) { post({ t: 'log', level: 'error', args: ['event ' + msg.name + ' failed: ' + toMessage(error)] }); });
      });
    }
  });

  scope.addEventListener('unhandledrejection', function (event) {
    post({ t: 'log', level: 'error', args: ['unhandled rejection: ' + toMessage(event.reason)] });
  });

  Object.defineProperty(scope, 'metadea', { value: metadea, writable: false, configurable: false });
})
