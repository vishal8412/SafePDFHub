export type CompressionLevel =
    | 'light'
    | 'recommended'
    | 'strong';

export type CompressionStage =
    | 'idle'
    | 'analysis'
    | 'optimization'
    | 'rebuild'
    | 'finalizing'
    | 'complete';