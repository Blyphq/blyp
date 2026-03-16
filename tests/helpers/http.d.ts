import http from 'http';
export declare function listen(handler: http.RequestListener): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
}>;
