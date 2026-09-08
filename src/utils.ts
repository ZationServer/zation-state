/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {networkInterfaces} from "os";

export function memoResult<T extends (...args: any[]) => any>(func: T): T {
    let cache: any | null = null;
    return ((...args) => {
        if(cache != null) return cache;
        const res = cache = func(...args);
        //do not keep a rejected promise cached
        if(res instanceof Promise) res.catch(() => {cache = null;});
        return res;
    }) as T;
}

/**
 * Returns the first external IPv4 address of this machine
 * (falls back to 127.0.0.1).
 */
export function localIpAddress(): string {
    const interfaces = networkInterfaces();
    for(const name of Object.keys(interfaces)) {
        for(const info of interfaces[name] || []) {
            if(!info.internal && (info.family === "IPv4" || (info.family as any) === 4)) return info.address;
        }
    }
    return "127.0.0.1";
}
