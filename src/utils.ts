/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

function memoResult<T extends (...args: any[]) => any>(func: T): T {
    let cache: any | null = null;
    return ((...args) => {
        if(cache != null) return cache;
        return cache = func(...args);
    }) as T;
}