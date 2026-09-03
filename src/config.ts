export interface AppConfig {
  appDir: string;
  host: string;
  port: number;
  configDir: string;
  rulesFile: string;
  tempDir: string;
  downloadDir: string;
  releaseDir: string;
  binDir: string;
  logDir: string;
  logLevel: string;
  logRetentionDays: number;
  dryRun: boolean;
}

function booleanFromEnvironment(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

export function loadConfig(environment = process.env): AppConfig {
  const appDir =
    environment.APP_DIR ??
    (process.cwd() === '/app' ? '/app' : `${process.cwd()}/app`);
  const configDir = environment.CONFIG_DIR ?? `${appDir}/config`;

  return {
    appDir,
    host: environment.HOST ?? 'localhost',
    port: Number(environment.PORT ?? '3000'),
    configDir,
    rulesFile: environment.RULES_FILE ?? `${configDir}/rules.yml`,
    tempDir: environment.TMP_DIR ?? `${appDir}/tmp`,
    downloadDir: environment.DOWNLOAD_DIR ?? `${appDir}/download`,
    releaseDir: environment.RELEASE_DIR ?? `${appDir}/release`,
    binDir: environment.BIN_DIR ?? `${appDir}/bin`,
    logDir: environment.LOG_DIR ?? `${appDir}/log`,
    logLevel: environment.LOG_LEVEL ?? 'info',
    logRetentionDays: Number(environment.LOG_RETENTION_DAYS ?? '30'),
    dryRun: booleanFromEnvironment(environment.DRY_RUN),
  };
}
