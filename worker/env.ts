export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  COOKIE_SECURE: 'auto' | 'true' | 'false';
  SESSION_SECRET: string;
  /** Service binding to the BOQ Maker Worker (`koochie-boq`); absent in a dev session that does not run it. */
  BOQ?: Fetcher;
  /** Service binding to the CRM Worker (`yourcrm`); absent in a dev session that does not run it. */
  CRM?: Fetcher;
  /** Same value as on koochie-boq and yourcrm; authenticates this app's calls to their integration endpoints. */
  INTEGRATION_SECRET?: string;
}
