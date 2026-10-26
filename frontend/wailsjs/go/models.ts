export namespace main {
	
	export class SidecarInfo {
	    URL: string;
	    Token: string;
	
	    static createFrom(source: any = {}) {
	        return new SidecarInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.URL = source["URL"];
	        this.Token = source["Token"];
	    }
	}

}

