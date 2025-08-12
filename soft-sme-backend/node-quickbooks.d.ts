declare module 'node-quickbooks' {
  export const AUTHORIZATION_URL: string;
  export const TOKEN_URL: string;
  
  interface QuickBooksConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    environment?: 'sandbox' | 'production';
    useSandbox?: boolean;
  }

  interface QuickBooksToken {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }

  interface QuickBooksInstance {
    // OAuth methods
    getAuthorizationUrl(): string;
    getAccessToken(code: string, realmId: string): Promise<QuickBooksToken>;
    refreshAccessToken(refreshToken: string): Promise<QuickBooksToken>;
    
    // API methods
    get(uri: string, options?: any): Promise<any>;
    post(uri: string, data: any, options?: any): Promise<any>;
    put(uri: string, data: any, options?: any): Promise<any>;
    delete(uri: string, options?: any): Promise<any>;
  }

  class QuickBooks {
    constructor(config: QuickBooksConfig);
    
    // Static methods
    static getAuthorizationUrl(config: QuickBooksConfig): string;
    static getAccessToken(code: string, config: QuickBooksConfig): Promise<QuickBooksToken>;
    static refreshAccessToken(refreshToken: string, config: QuickBooksConfig): Promise<QuickBooksToken>;
    
    // Instance methods
    get(uri: string, options?: any): Promise<any>;
    post(uri: string, data: any, options?: any): Promise<any>;
    put(uri: string, data: any, options?: any): Promise<any>;
    delete(uri: string, options?: any): Promise<any>;
  }

  export default QuickBooks;
} 