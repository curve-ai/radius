export interface CliIo {
  out(message: string): void;
  error(message: string): void;
}

export const processIo: CliIo = {
  out: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};
