declare module '@neslinesli93/qpdf-wasm' {
  interface QpdfWasmModuleOptions {
    readonly noInitialRun?: boolean;
    readonly locateFile?: () => string;
    readonly print?: (line: string) => void;
    readonly printErr?: (line: string) => void;
  }

  interface QpdfWasmModule {
    readonly FS: unknown;
    readonly WORKERFS: unknown;
    callMain(args: string[]): number;
    quit?: () => void;
  }

  const createQpdfModule: (options?: QpdfWasmModuleOptions) => Promise<QpdfWasmModule>;
  export default createQpdfModule;
}
