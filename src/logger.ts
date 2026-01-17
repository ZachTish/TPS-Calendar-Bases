let loggingEnabled = false;

export function setLoggingEnabled(value: boolean): void {
  loggingEnabled = !!value;
}

export function log(message?: any, ...optionalParams: any[]): void {
  if (!loggingEnabled) return;
  console.log(message, ...optionalParams);
}

export function warn(message?: any, ...optionalParams: any[]): void {
  if (!loggingEnabled) return;
  console.warn(message, ...optionalParams);
}

export function error(message?: any, ...optionalParams: any[]): void {
  if (!loggingEnabled) return;
  console.error(message, ...optionalParams);
}

