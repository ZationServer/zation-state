/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

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