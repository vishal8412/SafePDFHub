export interface CompressionPlan {
    strategy: 'safe' | 'smart' | 'strong';

    quality: number;

    scale: number;

    maxWidth: number;

    maxHeight: number;

    estimatedReduction: number;
}