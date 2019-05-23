/*
Author: Luca Scaringella
GitHub: LucaCode
©Copyright by Luca Scaringella
 */

//SC V 6.1.1
const ZATION_CLUSTER_VERSION = 1;

const argv                = require('minimist')(process.argv.slice(2));
const http                = require('http');
const socketCluster       = require('socketcluster-server');
const url                 = require('url');
const semverRegex         = /\d+\.\d+\.\d+/;
const packageVersion      = require(`./package.json`).version;
const requiredMajorSemver = getMajorSemver(packageVersion);
const HashSet             = require('hashset');
const uuidV4              = require('uuid/v4');

//DEFAULT
const DEFAULT_PORT = 7777;
const DEFAULT_CLUSTER_SCALE_OUT_DELAY = 5000;
const DEFAULT_CLUSTER_SCALE_BACK_DELAY = 1000;
const DEFAULT_CLUSTER_STARTUP_DELAY = 5000;
const DEFAULT_START_RECONNECT_DURATION = 2500;
const DEFAULT_WAIT_RECONNECT_DURATION = 5000;

const START_RECONNECT_DURATION = Number(process.env.startReconnectDuration) || DEFAULT_START_RECONNECT_DURATION;
const WAIT_RECONNECT_DURATION = Number(process.env.waitReconnectDuration) || DEFAULT_WAIT_RECONNECT_DURATION;
const PORT = Number(argv['p']) || Number(process.env.SCC_STATE_SERVER_PORT) || DEFAULT_PORT;
const AUTH_KEY = process.env.cak || process.env.CLUSTER_AUTH_KEY || process.env.SCC_AUTH_KEY || null;
const FORWARDED_FOR_HEADER = process.env.FORWARDED_FOR_HEADER || null;
const RETRY_DELAY = Number(argv['r']) || Number(process.env.SCC_STATE_SERVER_RETRY_DELAY) || 2000;
const CLUSTER_SCALE_OUT_DELAY = selectNumericArgument([argv['d'], process.env.SCC_STATE_SERVER_SCALE_OUT_DELAY, DEFAULT_CLUSTER_SCALE_OUT_DELAY]);
const CLUSTER_SCALE_BACK_DELAY = selectNumericArgument([argv['d'], process.env.SCC_STATE_SERVER_SCALE_BACK_DELAY, DEFAULT_CLUSTER_SCALE_BACK_DELAY]);
const STARTUP_DELAY = selectNumericArgument([argv['s'], process.env.SCC_STATE_SERVER_STARTUP_DELAY, DEFAULT_CLUSTER_STARTUP_DELAY]);

function selectNumericArgument(args) {
  let lastIndex = args.length - 1;
  for (let i = 0; i < lastIndex; i++) {
      let current = Number(args[i]);
    if (!isNaN(current) && args[i] != null) {
      return current;
    }
  }
  return Number(args[lastIndex]);
}

function logError(err) {
    if (LOG_LEVEL > 0) {
        console.error('\x1b[31m%s\x1b[0m', '   [Error]',err);
    }
}

function logBusy(txt) {
    if (LOG_LEVEL > 0) {
        console.error('\x1b[33m%s\x1b[0m', '   [BUSY]',txt);
    }
}

function logActive(txt) {
    if (LOG_LEVEL > 0) {
        console.error('\x1b[32m%s\x1b[0m', '   [ACTIVE]',txt);
    }
}

function logWarn(warn) {
    if (LOG_LEVEL >= 2) {
        console.warn('\x1b[31m%s\x1b[0m','   [WARNING]',warn);
    }
}

function logInfo(info) {
    if (LOG_LEVEL >= 2) {
        console.log('\x1b[34m%s\x1b[0m','   [INFO]',info);
    }
}

Object.size = function(obj) {
    let size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};

Object.getValueArray = function(obj) {
    let values = [], key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            values.push(obj[key]);
        }
    }
    return values;
};

/**
 * Log levels:
 * 3 - log everything
 * 2 - warnings and errors
 * 1 - errors only
 * 0 - log nothing
 */
let LOG_LEVEL;
if (typeof argv['l'] !== 'undefined') {
  LOG_LEVEL = Number(argv['l']);
} else if (typeof process.env.LOG_LEVEL !== 'undefined') {
  LOG_LEVEL = Number(process.env.LOG_LEVEL);
} else {
  LOG_LEVEL = 2;
}

const httpServer = http.createServer();
// noinspection JSCheckFunctionSignatures
const scServer = socketCluster.attach(httpServer,{});

process.title = `Zation Cluster State`;

httpServer.on('request', function (req, res) {
  if (req.url === '/health-check') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('OK');
  } else {
    res.writeHead(404, {'Content-Type': 'text/html'});
    res.end('Not found');
  }
});

const sccBrokerSockets = {};
const sccWorkerSockets = {};

//Cluster master
const regMasterSockets = {};
const joinMasterSockets = {};
const zMasterInstanceIds = new HashSet();
let zmLeaderSocketId = undefined;

let currentSettings = undefined;
let currentSharedData = undefined;
let currentReconnectUUID = undefined;

logBusy('Launching Zation-Cluster-State Server');

let serverReady = STARTUP_DELAY <= 0;
if (!serverReady) {
  logInfo(`Waiting ${STARTUP_DELAY}ms for initial zation-cluster-broker instances before allowing zation-worker instances to join`);
  setTimeout(function() {
    logInfo('State server is now allowing zation-worker instances to join the cluster');
    serverReady = true;
  }, STARTUP_DELAY);
}

const getSCCBrokerClusterState = function () {
  const sccBrokerURILookup = {};
   Object.keys(sccBrokerSockets).forEach((socketId) => {
    const socket = sccBrokerSockets[socketId];
    const targetProtocol = socket.instanceSecure ? 'wss' : 'ws';
    let instanceIp;
    if (socket.instanceIpFamily === 'IPv4') {
      instanceIp = socket.instanceIp;
    } else {
      instanceIp = `[${socket.instanceIp}]`;
    }
      const instanceURI = `${targetProtocol}://${instanceIp}:${socket.instancePort}`;
    sccBrokerURILookup[instanceURI] = true;
  });
  return {
    sccBrokerURIs: Object.keys(sccBrokerURILookup),
    time: Date.now()
  };
};

let clusterResizeTimeout;

const setClusterScaleTimeout = function (callback, delay) {
  // Only the latest scale request counts.
  if (clusterResizeTimeout) {
    clearTimeout(clusterResizeTimeout);
  }
  clusterResizeTimeout = setTimeout(callback, delay);
};

const sccBrokerLeaveCluster = function (socket, respond) {
  delete sccBrokerSockets[socket.id];
  setClusterScaleTimeout(() => {
    sendEventToAllInstances(sccWorkerSockets, 'sccBrokerLeaveCluster', getSCCBrokerClusterState());
  }, CLUSTER_SCALE_BACK_DELAY);

  respond && respond();
  logInfo(`The zation-cluster-broker instance ${socket.instanceId} at address ${socket.instanceIp} on port ${socket.instancePort} left the cluster on socket ${socket.id}`);
};

const sccWorkerLeaveCluster = function (socket, respond) {
  delete sccWorkerSockets[socket.id];
  respond && respond();
  logInfo(`The zation-worker instance ${socket.instanceId} at address ${socket.instanceIp} left the cluster on socket ${socket.id}`);
};

const sendEventToInstance = function (socket, event, data) {
    socket.emit(event, data,(err) => {
        if (err) {
            logError(err);
            if (socket.state === 'open') {
                setTimeout(sendEventToInstance.bind(null, socket, event, data), RETRY_DELAY);
            }
        }
    });
};

const sendEventToAllInstances = function (instances, event, data) {
    Object.keys(instances).forEach((socketId) => {
        sendEventToInstance(instances[socketId], event, data);
    });
};

const getRemoteIp = function (socket, data) {
  const forwardedAddress = FORWARDED_FOR_HEADER ? (socket.request.headers[FORWARDED_FOR_HEADER] || '').split(',')[0] : null;
  return data.instanceIp || forwardedAddress || socket.remoteAddress;
};

scServer.on('error', function (err) {
    if(LOG_LEVEL > 2) {
        logError(err);
    }
});

scServer.on('warning', function (err)
{
    if(LOG_LEVEL > 2) {
        logWarn(err);
    }
});

if (AUTH_KEY) {
  scServer.addMiddleware(scServer.MIDDLEWARE_HANDSHAKE_WS, (req, next) => {
    let urlParts = url.parse(req.url, true);
    if (urlParts['query'] && urlParts.query['authKey'] === AUTH_KEY) {
      next();
    } else {
      let err = new Error('Cannot connect to the zation-cluster-state instance without providing a valid authKey as a URL query argument.');
      err.name = 'BadClusterAuthError';
      next(err);
    }
  });
}

scServer.addMiddleware(scServer.MIDDLEWARE_HANDSHAKE_SC, (req, next) => {
  const remoteAddress = req.socket.remoteAddress;
  const urlParts = url.parse(req.socket.request.url, true);
  const { version, instanceType, instancePort } = urlParts.query;

  req.socket.instanceType = instanceType;
  req.socket.instancePort = instancePort;

  if(instanceType === 'zation-master') {
      const zationClusterVersion = urlParts.query['zationClusterVersion'];
      if(zationClusterVersion === ZATION_CLUSTER_VERSION){
          next();
      }
      else {
          const err = new Error('Zation master cannot connect to the state server with a not compatible zation cluster version.');
          err.name = 'BadZationClusterVersion';
          next(err);
      }
  }

  const reportedMajorSemver = getMajorSemver(version);
  const sccComponentIsObsolete = (!instanceType || Number.isNaN(reportedMajorSemver));
  let err;

  if (reportedMajorSemver === requiredMajorSemver) {
    return next();
  } else if (sccComponentIsObsolete) {
    err = new Error(`An obsolete zation-cluster component at address ${remoteAddress} is incompatible with the zation-cluster-state@^${packageVersion}. Please, update the zation-cluster component up to version ^${requiredMajorSemver}.0.0`);
  } else if (reportedMajorSemver > requiredMajorSemver) {
    err = new Error(`The zation-cluster-state@${packageVersion} is incompatible with the ${instanceType}@${version}. Please, update the zation-cluster-state up to version ^${reportedMajorSemver}.0.0`);
  } else {
    err = new Error(`The ${instanceType}@${version} at address ${remoteAddress}:${instancePort} is incompatible with the zation-cluster-state@^${packageVersion}. Please, update the ${instanceType} up to version ^${requiredMajorSemver}.0.0`);
  }

  err.name = 'CompatibilityError';
  return next(err);
});

scServer.on('connection', function (socket) {
    socket.on('sccBrokerJoinCluster', function (data, respond) {
        socket.instanceId = data.instanceId;
        socket.instanceIp = getRemoteIp(socket, data);
        // Only set instanceIpFamily if data.instanceIp is provided.
        if (data.instanceIp) {
            socket.instanceIpFamily = data.instanceIpFamily;
        }
        socket.instanceSecure = data.instanceSecure;
        sccBrokerSockets[socket.id] = socket;

        setClusterScaleTimeout(() => {
            sendEventToAllInstances(sccWorkerSockets, 'sccBrokerJoinCluster', getSCCBrokerClusterState());
        }, CLUSTER_SCALE_OUT_DELAY);

        respond();
        logInfo(`The zation-cluster-broker instance ${data.instanceId} at address ${socket.instanceIp} on port ${socket.instancePort} joined the cluster on socket ${socket.id}`);
    });

    socket.on('sccWorkerJoinCluster', function (data, respond) {
        socket.instanceId = data.instanceId;
        socket.instanceIp = getRemoteIp(socket, data);
        // Only set instanceIpFamily if data.instanceIp is provided.
        if (data.instanceIp) {
            socket.instanceIpFamily = data.instanceIpFamily;
        }

        if (!serverReady) {
            logWarn(`The zation-worker instance ${data.instanceId} at address ${socket.instanceIp} on socket ${socket.id} was not allowed to join the cluster because the server is waiting for initial brokers`);
            return respond(new Error('The server is waiting for initial broker connections'));
        }

        sccWorkerSockets[socket.id] = socket;
        respond(null, getSCCBrokerClusterState());
        logInfo(`The zation-worker instance ${data.instanceId} at address ${socket.instanceIp} joined the cluster on socket ${socket.id}`);
    });

    socket.on('zMasterRegister', (data, respond) => {
        if (!reconnectModeEngine.isReconnectModeActive()) {
            if (zMasterInstanceIds.contains(data.instanceId)) {
                //instance id all ready registered
                respond(null, {info: 'instanceIdAlreadyReg'});
                return;
            }

            const socketSettings = data['settings'];
            const socketSharedData = data['sharedData'];

            //register ip and id
            socket.instanceId = data.instanceId;
            socket.instanceIp = getRemoteIp(socket, data);
            // Only set instanceIpFamily if data.instanceIp is provided.
            if (data.instanceIp) {
                socket.instanceIpFamily = data.instanceIpFamily;
            }

            const addMaster = () => {
                regMasterSockets[socket.id] = socket;
                zMasterInstanceIds.add(socket.instanceId);
            };

            if (Object.size(regMasterSockets) === 0) {
                //First master
                currentSharedData = socketSharedData;
                currentSettings = new MasterSettings(socketSettings.useClusterSecretKey, socketSettings.useShareTokenAuth);
                currentReconnectUUID = uuidV4();
                addMaster();
                logInfo(`First new zation-master-server with instanceId ${socket.instanceId} is connected!, Settings '${currentSettings.toString()}' are saved!`);
                respond(null, {info: 'first', reconnectUUID: currentReconnectUUID});
            }
            else {
                //New master
                if (currentSettings instanceof MasterSettings && currentSettings.same(socketSettings.useClusterSecretKey, socketSettings.useShareTokenAuth)) {
                    addMaster();
                    respond(null, {info: 'ok', reconnectUUID: currentReconnectUUID, sharedData: currentSharedData});
                }
                else {
                    logInfo(`Zation-master-server with instanceId ${socket.instanceId} has not the same settings!`);
                    respond(null, {info: 'notSameSettings'});
                }
            }
        }
        else {
            respond(null,
                {
                    info: 'reconnectMode',
                    tryIn: reconnectModeEngine.getReconnectEnd() - Date.now(),
                    mode: reconnectModeEngine.getReconnectModeType()
                });
        }
    });

    socket.on('zMasterReconnect', async (data, respond) => {

        const socketReconnectUUID = data.reconnectUUID;
        const socketSettings = data['settings'];
        const socketSharedData = data['sharedData'];
        const socketWasLeader = data['wasLeader'];

        if (joinMasterSockets.hasOwnProperty(socket.id)) {
            respond(null, {info: 'alreadyJoined'});
        }

        //register ip and id
        socket.instanceId = data.instanceId;
        socket.instanceIp = getRemoteIp(socket, data);
        // Only set instanceIpFamily if data.instanceIp is provided.
        if (data.instanceIp) {
            socket.instanceIpFamily = data.instanceIpFamily;
        }

        const addMaster = () => {
            regMasterSockets[socket.id] = socket;
            zMasterInstanceIds.add(socket.instanceId);
            joinMasterSockets[socket.id] = socket;
        };

        if (currentReconnectUUID === socketReconnectUUID) {

            if (Object.size(regMasterSockets) === 0) {
                //first new reconnection
                currentSettings = new MasterSettings(socketSettings.useClusterSecretKey, socketSettings.useShareTokenAuth);
                currentSharedData = socketSharedData;
            }

            if (socketWasLeader) {
                //after reconnection time search new leader
                if (!zmLeaderSocketId) {
                    //new leader
                    zmLeaderSocketId = socket.id;
                    addMaster();
                    logInfo(`Old zation-master leader is reconnected with instanceId ${socket.instanceId} at address ${socket.instanceIp} on port ${socket.instancePort} with socketId ${socket.id}`);
                    respond(null, {info: 'ok'});
                }
                else {
                    //ups all ready an leader in cluster
                    respond(null, {info: 'removeLeadership'});
                }
            }
            else {
                addMaster();
                logInfo(`Old zation-master is reconnected with instanceId ${socket.instanceId} at address ${socket.instanceIp} on port ${socket.instancePort} with socketId ${socket.id}`);
                respond(null, {info: 'ok'});
            }
        }
        else {
            respond(null, {info: 'wrongReconnectUUID'});
        }
    });

    socket.on('zMasterJoin', (data, respond) => {
        //check for is reg before join
        if (!regMasterSockets.hasOwnProperty(socket.id)) {
            respond(new Error('Register master before join the cluster!'));
            return;
        }
        //join
        joinMasterSockets[socket.id] = socket;
        chooseLeader();
        respond(null);
        logInfo(`The zation-master instance ${socket.instanceId} at address ${socket.instanceIp} joined the cluster on socket ${socket.id}`);
    });

    socket.on('sccBrokerLeaveCluster', function (data, respond) {
        sccBrokerLeaveCluster(socket, respond);
    });

    socket.on('sccWorkerLeaveCluster', function (data, respond) {
        sccWorkerLeaveCluster(socket, respond);
    });

    socket.on('zationMasterLeaveCluster', function (data, respond) {
        zMasterLeaveCluster(socket, respond);
    });

    socket.on('disconnect', function () {
        if (socket.instanceType === 'scc-broker') {
            sccBrokerLeaveCluster(socket);
        } else if (socket.instanceType === 'scc-worker') {
            sccWorkerLeaveCluster(socket);
        } else if (socket.instanceType === 'zation-master') {
            zMasterLeaveCluster(socket);
        }
    });
});

const chooseLeader = function () {
  if(!zmLeaderSocketId && Object.size(joinMasterSockets) > 0) {
    logInfo(`State server search a new leader...`);
    const newLeader = getRandomZMaster();
    newLeader.emit('newLeader',{},(err) => {
      if(!err) {
          zmLeaderSocketId = newLeader.id;
          logInfo(`New zation-master leader is selected ${newLeader.instanceId} at address ${newLeader.instanceIp} on port ${newLeader.instancePort} with ${newLeader.id}`);
      }
      else {
        chooseLeader();
      }
    });
  }
};

const getRandomZMaster = function () {
  const socketIds = Object.getValueArray(joinMasterSockets);
  return socketIds[Math.floor(Math.random() * socketIds.length)];
};

const zMasterLeaveCluster = function (socket, respond) {

  delete joinMasterSockets[socket.id];
  delete regMasterSockets[socket.id];
  zMasterInstanceIds.remove(socket.instanceId);

  //check lead master
  if(zmLeaderSocketId === socket.id) {
    logInfo(`Leader zation-master-server is disconnected!`);
    zmLeaderSocketId = undefined;
    chooseLeader();
  }

  //check all servers are down
  if(Object.size(regMasterSockets) === 0) {
    //all removed
    currentSharedData = undefined;
    currentSettings = undefined;
    reconnectModeEngine.setReconnectMode();
    logInfo(`All master servers are down. Settings and shared data were reset.`);
  }

  respond && respond();
  logInfo(`The zation-master instance ${socket.instanceId} at address ${socket.instanceIp} on port ${socket.instancePort} left the cluster on socket ${socket.id}`);
};

httpServer.listen(PORT);
httpServer.on('listening', function () {
  logActive(`The Zation-Cluster-State Server is now listening on port ${PORT}`);
});

function getMajorSemver(semver) {
  const semverIsValid = typeof semver === 'string' && semver.match(semverRegex);

  if (semverIsValid) {
    const majorSemver = semver.split('.')[0];
    return parseInt(majorSemver);
  } else {
    return NaN;
  }
}

class ReconnectModeEngine {

    constructor(){
        //start reconnect
        this.reconnectMode = true;
        this.reconnectModeType = 'start';
        this.reconnectEnd = Date.now() + START_RECONNECT_DURATION;
        this.reconnectReset = setTimeout(() => {
            this.reconnectMode = false;
        },START_RECONNECT_DURATION);

        logInfo(`Start reconnect for ${START_RECONNECT_DURATION}ms active.`);
    }

    setReconnectMode() {
        clearTimeout(this.reconnectReset);
        this.reconnectMode = true;
        this.reconnectModeType = 'wait';
        this.reconnectEnd = Date.now() + WAIT_RECONNECT_DURATION;
        this.reconnectReset = setTimeout(() => {
            this.reconnectMode = false;
            chooseLeader();
        }, WAIT_RECONNECT_DURATION);

        logInfo(`Wait reconnect for ${WAIT_RECONNECT_DURATION}ms active.`);
    }

    isReconnectModeActive() {
        return this.reconnectMode;
    }

    getReconnectModeType() {
        return this.reconnectModeType;
    }

    getReconnectEnd() {
        return this.reconnectEnd;
    }
}

const reconnectModeEngine = new ReconnectModeEngine();

class MasterSettings {
    constructor(useClusterSecretKey,useShareTokenAuth) {
      this.useClusterSecretKey = useClusterSecretKey;
      this.useShareTokenAuth = useShareTokenAuth;
    }

    toString() {
        return `UseClusterSecretKey: ${this.useClusterSecretKey}, UseShareTokenAuth: ${this.useShareTokenAuth}`;
    }

    same(useClusterSecretKey,useShareTokenAuth) {
      return this.useClusterSecretKey === useClusterSecretKey && this.useShareTokenAuth === useShareTokenAuth;
    }
}