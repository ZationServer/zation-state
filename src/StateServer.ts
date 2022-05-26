/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {StateServer as ZironStateServer, StateServerOptions, Block} from 'ziron-state';
import MachineState from "machine-state";
import {version as SERVER_VERSION} from './../package.json';
import * as IP from 'ip';
import {violatesLicenseTerms} from "./violatesLicenseTerms";

export class StateServer extends ZironStateServer {

    private launchedTimestamp?: number;

    constructor(options: StateServerOptions = {}) {
        super(options);
        this._initStandaloneStateProcedure();
        this._startResetCounterInterval();
        this._initWorkerJoinMiddleware();
    }

    public async listen() {
        await super.listen();
        if(this.launchedTimestamp == null)
            this.launchedTimestamp = Date.now();
    }

    private _initStandaloneStateProcedure() {
        this.procedures['#state'] = async (socket, limitToDynamicInfo, end, reject) => {
            try {
                if(limitToDynamicInfo) end({
                    ...(await this.getDynamicServerStateInfo()),
                    id: this.id
                });
                else {
                    const [staticInfo,dynamicInfo] = await Promise.all([this.getStaticServerStateInfo(),
                        this.getDynamicServerStateInfo()]);
                    end({...staticInfo,...dynamicInfo,id: this.id});
                }
            }
            catch (e) {reject(new Error("Failed to load server state."))}
        };
    }

    private _startResetCounterInterval() {
        setInterval( () => {
            this.server.resetCounts();
        },1000);
    }

    private async getStaticServerStateInfo() {
        const server = this.server;
        return {
            type: 2,
            port: server.port,
            path: server.path,
            tls: server.tls,
            nodeVersion: process.version,
            ip: IP.address(),
            serverVersion: SERVER_VERSION,
            launchedTimestamp: this.launchedTimestamp,
            ...(await MachineState.getGeneralInfo())
        }
    }

    private async getDynamicServerStateInfo() {
        const server = this.server;
        return {
            clientCount: server.clientCount,
            resourceUsage: (await MachineState.getResourceUsageInfo()),
            httpMessageCount: server.httpMessageCount,
            wsMessageCount: server.wsMessageCount,
            invokeMessageCount: server.invokeMessageCount,
            transmitMessageCount: server.transmitMessageCount
        }
    }

    private _initWorkerJoinMiddleware() {
        this.workerJoinMiddleware = (_, payload) => {
            const license = payload.license;
            if(typeof license === 'object') {
                const currentLicenses: object[] = [];
                for(const worker of this.joinedWorkers) {
                    const workerLicense = worker.node.joinPayload?.license;
                    if(typeof workerLicense === 'object') currentLicenses.push(workerLicense);
                }
                if(violatesLicenseTerms([...currentLicenses,license]))
                    throw new Block("LicenseTermViolation","Join blocked because of license term violation.");
            }
        };
    }
}