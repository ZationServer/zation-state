/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {LogLevel} from "ziron-state";
import {secrets} from "docker-secret";
import {StateServer} from "./StateServer";

const variables = Object.assign({}, process.env, secrets);

process.title = `Zation State`;
new StateServer({
    secret: variables.SECRET,
    port: parseInt(variables.PORT) || 7777,
    path: variables.SERVER_PATH || "/",
    logLevel: isNaN(parseInt(variables.LOG_LEVEL)) ? LogLevel.Everything : parseInt(variables.LOG_LEVEL),
    scaleDelay: parseInt(variables.SCALE_DELAY) || 100
}).listen().catch(() => process.exit(1));