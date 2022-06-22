/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

interface License {
    /**
     * holder
     */
    h: string,
    /**
     * email
     */
    e: string,
    /**
     * level
     */
    l: LicenseLevel,
    /**
     * type
     */
    t: LicenseType
    /**
     * Max instances
     * The maximal amount of instances which are allowed.
     * -1 = unlimited amount.
     * number > 0 = specific max amount.
     */
    mi: number,
    /**
     * version
     */
    v: number,
    /**
     * id
     */
    i: string,
    /**
     * created timestamp
     */
    c: number
}

export enum LicenseLevel {
    Standard
}

export enum LicenseType {
    Single,
    Cluster,
    Multi
}

export function violatesLicenseTerms(licenses: License[]): boolean {
    const licenseOccurrence: Record<string,number> = {};
    for(const license of licenses) {
        if(!license) continue;
        const id = license.i;
        switch(license.t) {
            case LicenseType.Single:
                if(licenseOccurrence.hasOwnProperty(id)) return true;
                break;
            case LicenseType.Cluster:
            case LicenseType.Multi:
                const currentCount = licenseOccurrence[id] || 0;
                if(license.mi !== -1 && currentCount >= license.mi) return true;
                break;
        }
        if(licenseOccurrence[id] == null) licenseOccurrence[id] = 1;
        else licenseOccurrence[id]++;
    }
    return false;
}