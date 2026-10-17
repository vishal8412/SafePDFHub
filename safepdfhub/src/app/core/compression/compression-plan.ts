export interface CompressionPlan {
    targetBytes?: number;
    allowGrayscale?: boolean;
    sizePriority?: boolean;
    strategy: 'safe' | 'smart' | 'strong';

    quality: number;

    scale: number;

    maxWidth: number;

    maxHeight: number;

    estimatedReduction: number;
}
