/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {StateServer,LogLevel} from "ziron-state";
import {secrets} from "docker-secret";

const variables = Object.assign({}, process.env, secrets);

process.title = `Zation State`;
new StateServer({
    secret: variables.SECRET,
    port: parseInt(variables.PORT) || 7777,
    path: variables.SERVER_PATH || "/",
    logLevel: parseInt(variables.LOG_LEVEL) || LogLevel.Everything,
    scaleDelay: parseInt(variables.SCALE_DELAY) || 100
}).listen().catch(() => process.exit(1));