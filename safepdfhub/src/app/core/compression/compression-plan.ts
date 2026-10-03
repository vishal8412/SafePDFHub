export interface CompressionPlan {
    targetBytes?: number;
    strategy: 'safe' | 'smart' | 'strong';

    quality: number;

    scale: number;

    maxWidth: number;

    maxHeight: number;

    estimatedReduction: number;
}